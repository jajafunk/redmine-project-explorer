# frozen_string_literal: true

require 'open3'

module RedmineProjectExplorer
  class MermaidStandardSvgRenderer
    def initialize(source)
      @source =
        source.to_s.gsub(/\r\n?/, "\n")
    end

    def render
      raise ArgumentError, 'Mermaid source is empty' if @source.strip.empty?

      plugin_root =
        File.expand_path(
          '../../..',
          __dir__
        )

      script =
        File.join(
          plugin_root,
          'scripts',
          'render_mermaid_svg.js'
        )

      mermaid_js =
        File.join(
          plugin_root,
          'assets',
          'javascripts',
          'vendor',
          'mermaid.min.js'
        )

      env = {
        'RPE_MERMAID_JS' => mermaid_js,
        'RPE_CHROMIUM' => '/usr/bin/chromium'
      }

      stdout, stderr, status =
        Open3.capture3(
          env,
          'node',
          script,
          stdin_data: @source
        )

      unless status.success?
        message =
          stderr.to_s.strip

        message =
          stdout.to_s.strip if message.empty?

        raise(
          "Mermaid standard API rendering failed " \
          "(status=#{status.exitstatus}): " \
          "#{message}"
        )
      end

      svg =
        stdout.to_s.strip

      unless svg.include?('<svg')
        raise(
          'Mermaid standard API returned no SVG'
        )
      end

      svg
    end
  end
end
