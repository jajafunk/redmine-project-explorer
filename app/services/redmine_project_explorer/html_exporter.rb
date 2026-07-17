# frozen_string_literal: true

require 'cgi'
require 'fileutils'
require 'tmpdir'
require 'zip'

module RedmineProjectExplorer
  class HtmlExporter
    attr_reader :project, :root_issue, :user, :view_context

    def initialize(project:, root_issue: nil, user:, view_context:)
      @project = project
      @root_issue = root_issue
      @user = user
      @view_context = view_context
    end

    def call
      @work_dir = Dir.mktmpdir('redmine-project-explorer-')
      @export_dir = File.join(@work_dir, export_name)

      FileUtils.mkdir_p(File.join(@export_dir, 'issues'))
      FileUtils.mkdir_p(File.join(@export_dir, 'assets'))
      FileUtils.mkdir_p(File.join(@export_dir, 'attachments'))

      load_issues

      write_file('index.html', tree_page)
      write_file('assets/project-explorer.css', export_css)
      write_file('assets/project-explorer.js', export_js)

      @issues.each do |issue|
        copy_attachments(issue)
        write_file("issues/issue-#{issue.id}.html", issue_page(issue))
      end

      zip_path = File.join(@work_dir, "#{export_name}.zip")
      create_zip(zip_path)

      [zip_path, File.basename(zip_path), @work_dir]
    end

    private

    def load_issues
      scope = project.issues.visible(user)
                     .includes(
                       :project, :tracker, :status, :priority, :assigned_to,
                       :author, :fixed_version, :category, :attachments,
                       :custom_values, :journals
                     )

      if root_issue
        scope = scope.where(root_id: root_issue.root_id)
                     .where(
                       'issues.lft >= ? AND issues.rgt <= ?',
                       root_issue.lft,
                       root_issue.rgt
                     )
      end

      @issues = scope.order(:root_id, :lft, :id).to_a
      @issue_ids = @issues.index_by(&:id)
      @children = @issues.group_by(&:parent_id)
      @root_issues = @issues.select do |issue|
        issue.parent_id.blank? || !@issue_ids.key?(issue.parent_id)
      end
    end

    def export_name
      @export_name ||= begin
        timestamp = Time.current.strftime('%Y%m%d-%H%M%S')

        if root_issue
          "project-explorer-issue-#{root_issue.id}-#{timestamp}"
        else
          "project-explorer-project-#{project.identifier}-#{timestamp}"
        end
      end
    end

    def write_file(relative_path, content)
      path = File.join(@export_dir, relative_path)
      FileUtils.mkdir_p(File.dirname(path))
      File.write(path, content, mode: 'w:UTF-8')
    end

    def h(value)
      CGI.escapeHTML(value.to_s)
    end

    def textilized(object, attribute)
      view_context.textilizable(object, attribute)
    rescue StandardError
      "<pre>#{h(object.public_send(attribute))}</pre>"
    end

    def format_date_value(value)
      value ? h(view_context.format_date(value)) : '-'
    rescue StandardError
      value ? h(value.to_s) : '-'
    end

    def format_time_value(value)
      value ? h(view_context.format_time(value)) : '-'
    rescue StandardError
      value ? h(value.to_s) : '-'
    end

    def issue_link(issue, from_tree:)
      href = from_tree ? "issues/issue-#{issue.id}.html" : "issue-#{issue.id}.html"
      %(<a href="#{href}">##{issue.id} #{h(issue.subject)}</a>)
    end

    def tree_page
      page_title =
        if root_issue
          "##{root_issue.id} #{h(root_issue.subject)}"
        else
          "#{h(project.name)}－全チケット"
        end

      tree_html = @root_issues.map { |issue| tree_node(issue) }.join("
")

      <<~HTML
        <!doctype html>
        <html lang="ja">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <title>#{page_title}</title>
          <link rel="stylesheet" href="assets/project-explorer.css">
          <script defer src="assets/project-explorer.js"></script>
        </head>
        <body>
          <header class="page-header">
            <div>
              <p class="eyebrow">Redmine Project Explorer HTML Export</p>
              <h1>#{page_title}</h1>
              <p>#{@issues.size}件 / #{h(Time.current.to_s)}</p>
            </div>
            <div class="actions">
              <button type="button" data-expand-all>すべて展開</button>
              <button type="button" data-collapse-all>すべて折りたたむ</button>
            </div>
          </header>
          <main>
            <section class="tree-card">
              <ul class="issue-tree root-tree">
                #{tree_html}
              </ul>
            </section>
          </main>
        </body>
        </html>
      HTML
    end

    def tree_node(issue)
      children = Array(@children[issue.id])
      has_children = children.any?
      status = [
        issue.tracker&.name,
        issue.status&.name,
        issue.assigned_to&.name,
        "#{issue.done_ratio}%"
      ].compact.join(' / ')

      control = if has_children
                  '<button type="button" class="tree-toggle" aria-expanded="true"></button>'
                else
                  '<span class="tree-spacer"></span>'
                end

      child_html = if has_children
                     %(<ul class="issue-tree children">#{children.map { |child| tree_node(child) }.join}</ul>)
                   else
                     ''
                   end

      <<~HTML
        <li class="tree-item">
          <div class="tree-row">
            #{control}
            <div>
              <div class="tree-title">#{issue_link(issue, from_tree: true)}</div>
              <div class="tree-meta">#{h(status)}</div>
            </div>
          </div>
          #{child_html}
        </li>
      HTML
    end

    def issue_page(issue)
      parent = @issue_ids[issue.parent_id]
      children = Array(@children[issue.id])

      <<~HTML
        <!doctype html>
        <html lang="ja">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <title>##{issue.id} #{h(issue.subject)}</title>
          <link rel="stylesheet" href="../assets/project-explorer.css">
        </head>
        <body>
          <header class="page-header">
            <div>
              <p class="eyebrow">Redmine Issue</p>
              <h1>##{issue.id} #{h(issue.subject)}</h1>
              <p>#{h(issue.project.name)} / #{h(issue.tracker.name)} / #{h(issue.status.name)}</p>
            </div>
            <a class="button primary" href="../index.html">← ツリーへ戻る</a>
          </header>

          <main class="issue-main">
            <section class="card">
              <h2>基本情報</h2>
              <dl class="properties">
                #{property('プロジェクト', issue.project.name)}
                #{property('トラッカー', issue.tracker.name)}
                #{property('ステータス', issue.status.name)}
                #{property('優先度', issue.priority&.name || '-')}
                #{property('担当者', issue.assigned_to&.name || '-')}
                #{property('作成者', issue.author&.name || '-')}
                #{property('開始日', format_date_value(issue.start_date), raw: true)}
                #{property('期日', format_date_value(issue.due_date), raw: true)}
                #{property('進捗率', "#{issue.done_ratio}%")}
                #{property('対象バージョン', issue.fixed_version&.name || '-')}
                #{property('カテゴリ', issue.category&.name || '-')}
                #{property('作成日時', format_time_value(issue.created_on), raw: true)}
                #{property('更新日時', format_time_value(issue.updated_on), raw: true)}
              </dl>
            </section>

            <section class="card">
              <h2>説明</h2>
              <div class="wiki">
                #{issue.description.present? ? textilized(issue, :description) : '<p class="empty">説明はありません。</p>'}
              </div>
            </section>

            #{custom_fields_section(issue)}
            #{tree_relation_section(parent, children)}
            #{attachments_section(issue)}
            #{journals_section(issue)}

            <p><a class="button primary" href="../index.html">← ツリーへ戻る</a></p>
          </main>
        </body>
        </html>
      HTML
    end

    def property(label, value, raw: false)
      rendered = raw ? value : h(value)
      "<div><dt>#{h(label)}</dt><dd>#{rendered}</dd></div>"
    end

    def custom_fields_section(issue)
      rows = issue.visible_custom_field_values(user).filter_map do |value|
        next if value.value.blank?

        property(value.custom_field.name, value.value)
      end.join

      return '' if rows.empty?

      %(<section class="card"><h2>カスタムフィールド</h2><dl class="properties">#{rows}</dl></section>)
    rescue StandardError
      ''
    end

    def tree_relation_section(parent, children)
      parent_html = parent ? issue_link(parent, from_tree: false) : '-'
      children_html = if children.any?
                        "<ul>#{children.map { |child| "<li>#{issue_link(child, from_tree: false)}</li>" }.join}</ul>"
                      else
                        '<p class="empty">子チケットはありません。</p>'
                      end

      <<~HTML
        <section class="card">
          <h2>案件ツリー</h2>
          <p><strong>親案件:</strong> #{parent_html}</p>
          <div><strong>子案件:</strong> #{children_html}</div>
        </section>
      HTML
    end

    def attachments_section(issue)
      attachments = issue.attachments.select do |attachment|
        attachment.visible?(user)
      rescue StandardError
        true
      end

      return '' if attachments.empty?

      items = attachments.map do |attachment|
        filename = safe_filename(attachment.filename)
        %(<li><a href="../attachments/issue-#{issue.id}/#{h(filename)}">#{h(attachment.filename)}</a></li>)
      end.join

      %(<section class="card"><h2>添付ファイル</h2><ul>#{items}</ul></section>)
    end

    def journals_section(issue)
      journals = issue.journals.select do |journal|
        journal.notes.present? &&
          (!journal.private_notes || user.allowed_to?(:view_private_notes, issue.project))
      end

      return '' if journals.empty?

      entries = journals.map do |journal|
        <<~HTML
          <article class="journal">
            <p class="journal-meta">#{h(journal.user&.name || '-')} / #{format_time_value(journal.created_on)}</p>
            <div class="wiki">#{textilized(journal, :notes)}</div>
          </article>
        HTML
      end.join

      %(<section class="card"><h2>コメント</h2>#{entries}</section>)
    end

    def safe_filename(filename)
      cleaned = filename.to_s
                        .encode('UTF-8', invalid: :replace, undef: :replace, replace: '_')
                        .gsub(/[\/\\:\*\?"<>\|\x00-\x1f]/, '_')
                        .sub(/\A\.+/, '')

      cleaned.present? ? cleaned : 'attachment'
    end

    def copy_attachments(issue)
      target = File.join(@export_dir, 'attachments', "issue-#{issue.id}")
      used = {}

      issue.attachments.each do |attachment|
        visible = attachment.visible?(user)
        next unless visible
        next unless File.file?(attachment.diskfile)

        FileUtils.mkdir_p(target)

        filename = safe_filename(attachment.filename)
        if used[filename]
          ext = File.extname(filename)
          filename = "#{File.basename(filename, ext)}-#{attachment.id}#{ext}"
        end

        used[filename] = true
        FileUtils.cp(attachment.diskfile, File.join(target, filename))
      rescue StandardError => e
        Rails.logger.warn("[Project Explorer Export] attachment #{attachment.id}: #{e.message}")
      end
    end

    def create_zip(zip_path)
      entries = Dir.chdir(@export_dir) do
        Dir.glob('**/*', File::FNM_DOTMATCH)
           .reject { |entry| entry == '.' || entry == '..' }
      end

      Zip::File.open(zip_path, create: true) do |zip|
        entries.each do |entry|
          absolute = File.join(@export_dir, entry)

          if File.directory?(absolute)
            zip.mkdir(entry) unless zip.find_entry(entry)
          else
            zip.add(entry, absolute)
          end
        end
      end
    end

    def export_js
      <<~JS
        document.addEventListener('DOMContentLoaded', () => {
          const setExpanded = (button, expanded) => {
            const children = button.closest('.tree-item')?.querySelector(':scope > .children');
            if (!children) return;

            button.setAttribute('aria-expanded', String(expanded));
            children.hidden = !expanded;
          };

          document.querySelectorAll('.tree-toggle').forEach((button) => {
            button.addEventListener('click', () => {
              setExpanded(button, button.getAttribute('aria-expanded') !== 'true');
            });
          });

          document.querySelector('[data-expand-all]')?.addEventListener('click', () => {
            document.querySelectorAll('.tree-toggle').forEach((button) => setExpanded(button, true));
          });

          document.querySelector('[data-collapse-all]')?.addEventListener('click', () => {
            document.querySelectorAll('.tree-toggle').forEach((button) => setExpanded(button, false));
          });
        });
      JS
    end

    def export_css
      <<~CSS
        :root{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Yu Gothic",Meiryo,sans-serif;color:#18212a;background:#f4f6f8;line-height:1.6}
        *{box-sizing:border-box}body{margin:0}a{color:#1769aa;text-decoration:none}a:hover{text-decoration:underline}
        .page-header{display:flex;justify-content:space-between;align-items:center;gap:20px;padding:22px clamp(14px,4vw,46px);background:#fff;border-bottom:1px solid #dce1e6}
        .page-header h1{margin:2px 0;font-size:clamp(1.3rem,3vw,2rem)}.page-header p{margin:0;color:#68737d}.eyebrow{font-size:.78rem;letter-spacing:.08em}
        .actions{display:flex;gap:8px}.button,button{border:1px solid #aeb8c2;border-radius:7px;background:#fff;padding:8px 13px;font:inherit;cursor:pointer}.button.primary{background:#1769aa;color:#fff;border-color:#1769aa}
        main{max-width:1200px;margin:auto;padding:24px clamp(12px,3vw,30px) 48px}.tree-card,.card{background:#fff;border:1px solid #dce1e6;border-radius:10px;padding:18px;box-shadow:0 2px 8px rgba(20,35,50,.05)}
        .issue-main{max-width:1000px}.card{margin-bottom:18px}.card h2{margin:0 0 14px;border-bottom:1px solid #e5e9ed;padding-bottom:8px;font-size:1.15rem}
        .issue-tree{list-style:none;margin:0;padding-left:24px}.root-tree{padding-left:0}.tree-row{display:flex;gap:7px;align-items:flex-start;padding:6px 4px;border-radius:6px}.tree-row:hover{background:#f3f7fa}
        .tree-toggle{width:26px;height:26px;padding:0;border:0;background:transparent}.tree-toggle:before{content:"▶";font-size:12px}.tree-toggle[aria-expanded=true]:before{content:"▼"}.tree-spacer{display:inline-block;width:26px}.tree-title{font-weight:650}.tree-meta,.journal-meta,.empty{color:#68737d;font-size:.85rem}
        [hidden]{display:none!important}.properties{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0 26px}.properties>div{display:grid;grid-template-columns:9rem 1fr;border-bottom:1px solid #edf0f2;padding:8px 0}.properties dt{color:#68737d;font-weight:600}.properties dd{margin:0;overflow-wrap:anywhere}
        .wiki{overflow-wrap:anywhere}.wiki pre{overflow:auto;background:#f5f7f9;border:1px solid #dce1e6;border-radius:6px;padding:12px}.wiki img{max-width:100%;height:auto}.journal{border-top:1px solid #e5e9ed;padding:14px 0}
        @media(max-width:700px){.page-header{align-items:flex-start;flex-direction:column}.properties{grid-template-columns:1fr}.properties>div{grid-template-columns:7rem 1fr}.issue-tree{padding-left:16px}}
        @media print{.actions,.button{display:none}.tree-card,.card{box-shadow:none}}
      CSS
    end
  end
end
