# frozen_string_literal: true

require 'cgi'
require 'digest'
require 'fileutils'
require 'open3'
require 'base64'
require 'json'
require_relative '../../app/services/redmine_project_explorer/mermaid_standard_svg_renderer'
require_relative '../../app/services/redmine_project_explorer/flowchart_svg_renderer'

module RedmineProjectExplorer
  module PdfSequenceSupport
    PREFIX = 'project_explorer_png:'

    module_function

    # Convert a rendered Redmine <pre> Mermaid block to a locally generated
    # PNG image before RBPDF consumes the HTML.  RBPDF cannot render SVG
    # directly, so the plugin first renders SVG with its offline renderer and
    # then rasterizes that SVG to PNG with the local ImageMagick executable.
    def replace_sequence_blocks(html, raw_source = nil)
      source_html = html.to_s
      raw_text = raw_source.to_s
      replaced = false

      result = source_html.gsub(%r{<pre\b[^>]*>.*?</pre>}mi) do |block|
        source = extract_source(block)

        # RedmineのPDF用Markdown変換では、コードブロック先頭の
        # flowchart/graph ヘッダがHTML側から落ちる場合がある。
        # その場合だけ保存されている元テキストを使用する。
        unless source.match?(/\A(?:sequenceDiagram|flowchart|graph)\b/i)
          if raw_text.match?(/\A\s*(?:sequenceDiagram|flowchart|graph)\b/i)
            source = raw_text.strip
          end
        end

        renderer =
          if source.match?(/\AsequenceDiagram\b/i)
            RedmineProjectExplorer::MermaidStandardSvgRenderer.new(source)
          elsif source.match?(/\A(?:flowchart|graph)\s+(?:TD|TB|BT|LR|RL)\b/i)
            RedmineProjectExplorer::MermaidStandardSvgRenderer.new(source)
          end

        next block unless renderer

        begin
          svg = renderer.render
          paths = cache_png_slices(svg)

          replaced = true

          payload =
            Base64.strict_encode64(
              JSON.generate(paths)
            )

          %(<rpe-mermaid-pages data-images="#{payload}"></rpe-mermaid-pages>)
        rescue StandardError => e
          log("render failed: #{e.class}: #{e.message}")
          block
        end
      end

      log("mermaid block replaced=#{replaced}")
      result
    end

    # Split a tall Mermaid SVG into vertical slices before TCPDF receives it.
    # This prevents TCPDF from moving the whole diagram to the next page.
    #
    # Each slice keeps the original width, so the diagram scale/readability
    # remains consistent. TCPDF can then place the first slice immediately
    # after the Mermaid header and continue subsequent slices on following pages.
    def cache_png_slices(svg)
      path = cache_png(svg)

      stdout, stderr, status =
        Open3.capture3(
          'magick',
          'identify',
          '-format',
          '%w %h',
          path
        )

      unless status.success?
        raise(
          "Cannot determine Mermaid PNG size: " \
          "#{path}: #{stderr}"
        )
      end

      width_text, height_text =
        stdout.to_s.strip.split(/\s+/, 2)

      width =
        width_text.to_f

      height =
        height_text.to_f

      unless width.positive? &&
             height.positive?
        raise(
          "Invalid Mermaid PNG size: " \
          "#{path}: #{stdout}"
        )
      end

      [
        {
          'path' => path,
          'width' => width,
          'height' => height
        }
      ]
    end

    def extract_source(block)
      CGI.unescapeHTML(
        block.gsub(%r{</?code\b[^>]*>}mi, '')
             .gsub(%r{</?pre\b[^>]*>}mi, '')
             .gsub(/<br\s*\/?\s*>/i, "\n")
             .gsub(/<[^>]+>/, '')
      ).strip
    end

    def cache_root
      Rails.root.join('tmp', 'redmine_project_explorer_pdf').to_s
    end

    def cache_png(svg)
      FileUtils.mkdir_p(cache_root)
      digest = Digest::SHA256.hexdigest(svg)
      svg_path = File.join(cache_root, "#{digest}.svg")
      png_path = File.join(cache_root, "#{digest}.png")

      File.binwrite(svg_path, svg) unless File.exist?(svg_path)
      return png_path if File.file?(png_path) && File.size?(png_path)

      # Use argument-array execution (not a shell command) so generated paths
      # are passed safely.  All rendering remains local to the Redmine host.
      stdout, stderr, status = Open3.capture3(
        'magick',
        '-background', 'white',
        '-density', '144',
        svg_path,
        '-alpha', 'remove',
        '-alpha', 'off',
        png_path
      )

      unless status.success? && File.file?(png_path) && File.size?(png_path)
        FileUtils.rm_f(png_path)
        message = stderr.to_s.strip
        message = stdout.to_s.strip if message.empty?
        raise "rsvg-convert SVG->PNG failed (status=#{status.exitstatus}): #{message}"
      end

      log("rasterized SVG to PNG #{png_path}")
      png_path
    end

    def log(message)
      Rails.logger.info("[Project Explorer PDF Mermaid] #{message}") if defined?(Rails) && Rails.respond_to?(:logger)
    rescue StandardError
      nil
    end
  end

  # Patch pdf_format_text at the actual module that defines the method.
  module IssuesPdfHelperPatch
    def pdf_format_text(object, attribute)
      html = super

      raw_source =
        if object.respond_to?(attribute)
          object.public_send(attribute)
        end

      RedmineProjectExplorer::PdfSequenceSupport.replace_sequence_blocks(
        html,
        raw_source
      )
    end

  end

  # Redmine's ITCPDF resolves <img src="..."> through get_image_filename.
  # Permit only PNG files generated by this plugin under Rails.root/tmp.
  module ItcpdfProjectExplorerImagePatch

    MERMAID_PAGE_MARKER =
      %r{<rpe-mermaid-pages\s+data-images="([^"]+)"\s*></rpe-mermaid-pages>}i

    # Mermaidだけは通常のHTML <img> 配置を使用しない。
    #
    # 現在のY座標から1枚目を開始し、
    # ページ下端まで描画した後、
    # 残りを次ページ上端から連続して配置する。
    def writeHTML(html, *args)
      source = html.to_s

      unless source.match?(MERMAID_PAGE_MARKER)
        return super
      end

      cursor = 0

      source.to_enum(
        :scan,
        MERMAID_PAGE_MARKER
      ).each do

        match = Regexp.last_match

        before =
          source[
            cursor...match.begin(0)
          ].to_s

        super(before, *args) unless before.empty?

        begin
          paths =
            JSON.parse(
              Base64.strict_decode64(
                match[1]
              )
            )

          rpe_draw_mermaid_pages(paths)
        rescue StandardError => e
          RedmineProjectExplorer::PdfSequenceSupport.log(
            "direct Mermaid placement failed: #{e.class}: #{e.message}"
          )
        end

        cursor = match.end(0)
      end

      rest =
        source[cursor..].to_s

      super(rest, *args) unless rest.empty?

      nil
    end

    def rpe_draw_mermaid_pages(paths)
      return if paths.nil? || paths.empty?

      margins =
        respond_to?(:getMargins) ?
          getMargins :
          {}

      left =
        if margins.respond_to?(:[])
          margins['left'] ||
            margins[:left] ||
            15.0
        else
          15.0
        end

      right =
        if margins.respond_to?(:[])
          margins['right'] ||
            margins[:right] ||
            15.0
        else
          15.0
        end

      top =
        if margins.respond_to?(:[])
          margins['top'] ||
            margins[:top] ||
            15.0
        else
          15.0
        end

      page_width =
        get_page_width.to_f

      page_height =
        get_page_height.to_f

      break_margin =
        if respond_to?(:getBreakMargin)
          getBreakMargin.to_f
        else
          15.0
        end

      usable_width =
        page_width -
        left.to_f -
        right.to_f

      paths.each do |entry|
        next unless entry.is_a?(Hash)

        path =
          entry['path'].to_s

        pixel_w =
          entry['width'].to_i

        pixel_h =
          entry['height'].to_i

        next unless File.file?(path)

        unless pixel_w.positive? &&
               pixel_h.positive?
          raise(
            "Invalid Mermaid PNG size: #{path}"
          )
        end

        # PDF上で画像幅をusable_widthに合わせる。
        # 1pxあたり何mmになるかを求める。
        mm_per_pixel =
          usable_width /
          pixel_w.to_f

        offset_y = 0

        while offset_y < pixel_h
          current_y =
            get_y.to_f

          available_h =
            page_height -
            break_margin -
            current_y

          # 現在ページにほとんど空きがない場合だけ次ページへ。
          if available_h < 10.0
            AddPage()
            set_y(top.to_f)

            current_y =
              get_y.to_f

            available_h =
              page_height -
              break_margin -
              current_y
          end

          remaining_pixels =
            pixel_h -
            offset_y

          max_pixels_this_page =
            (
              available_h /
              mm_per_pixel
            ).floor

          crop_h =
            [
              remaining_pixels,
              max_pixels_this_page
            ].min

          if crop_h <= 0
            AddPage()
            set_y(top.to_f)
            next
          end

          crop_path =
            File.join(
              File.dirname(path),
              "#{File.basename(path, '.png')}" \
              "_crop_#{offset_y}_#{crop_h}.png"
            )

          unless File.file?(crop_path)
            geometry =
              "#{pixel_w}x#{crop_h}+0+#{offset_y}"

            stdout, stderr, status =
              Open3.capture3(
                'magick',
                path,
                '-crop',
                geometry,
                '+repage',
                crop_path
              )

            unless status.success? &&
                   File.file?(crop_path)
              raise(
                "Mermaid PNG crop failed: " \
                "#{geometry}: #{stderr}#{stdout}"
              )
            end
          end

          draw_w =
            usable_width

          draw_h =
            crop_h *
            mm_per_pixel

          Image(
            crop_path,
            left.to_f,
            current_y,
            draw_w,
            draw_h
          )

          set_y(
            current_y +
            draw_h
          )

          offset_y += crop_h

          # まだ残っている場合だけ次ページへ。
          if offset_y < pixel_h
            AddPage()
            set_y(top.to_f)
          end
        end
      end
    end

    def get_image_filename(attrname)
      value = attrname.to_s
      prefix = RedmineProjectExplorer::PdfSequenceSupport::PREFIX

      if value.start_with?(prefix)
        requested = File.expand_path(CGI.unescapeHTML(value.delete_prefix(prefix)))
        root = File.expand_path(RedmineProjectExplorer::PdfSequenceSupport.cache_root)
        if requested.start_with?(root + File::SEPARATOR) &&
           requested.end_with?('.png') && File.file?(requested)
          RedmineProjectExplorer::PdfSequenceSupport.log("using local PNG #{requested}")
          return requested
        end
      end

      super
    end
  end
end

# Install the patches immediately during plugin initialization. In production,
# registering only a to_prepare callback can be too late. apply! is idempotent,
# so it is also called from to_prepare for development reloads.
module RedmineProjectExplorer
  module PdfPatchInstaller
    module_function

    def apply!
      require_dependency 'issues_helper'
      require_dependency Rails.root.join('lib/redmine/export/pdf/issues_pdf_helper').to_s
      require_dependency Rails.root.join('lib/redmine/export/pdf').to_s

      pdf_helper = Redmine::Export::PDF::IssuesPdfHelper
      pdf_helper.prepend(RedmineProjectExplorer::IssuesPdfHelperPatch) unless
        pdf_helper.ancestors.include?(RedmineProjectExplorer::IssuesPdfHelperPatch)

      IssuesHelper.prepend(RedmineProjectExplorer::IssuesPdfHelperPatch) unless
        IssuesHelper.ancestors.include?(RedmineProjectExplorer::IssuesPdfHelperPatch)

      pdf_class = Redmine::Export::PDF::ITCPDF
      pdf_class.prepend(RedmineProjectExplorer::ItcpdfProjectExplorerImagePatch) unless
        pdf_class.ancestors.include?(RedmineProjectExplorer::ItcpdfProjectExplorerImagePatch)

      RedmineProjectExplorer::PdfSequenceSupport.log(
        "patch active: issues_helper=#{IssuesHelper.ancestors.include?(RedmineProjectExplorer::IssuesPdfHelperPatch)} " \
        "pdf_helper=#{pdf_helper.ancestors.include?(RedmineProjectExplorer::IssuesPdfHelperPatch)} " \
        "itcpdf=#{pdf_class.ancestors.include?(RedmineProjectExplorer::ItcpdfProjectExplorerImagePatch)}"
      )
      true
    rescue StandardError => e
      RedmineProjectExplorer::PdfSequenceSupport.log(
        "patch install failed: #{e.class}: #{e.message}"
      )
      false
    end
  end
end

RedmineProjectExplorer::PdfPatchInstaller.apply!

Rails.configuration.to_prepare do
  RedmineProjectExplorer::PdfPatchInstaller.apply!
end
