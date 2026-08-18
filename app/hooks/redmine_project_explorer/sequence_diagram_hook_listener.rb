module RedmineProjectExplorer
  class SequenceDiagramHookListener < Redmine::Hook::ViewListener
    def view_layouts_base_html_head(context = {})
      controller = context[:controller]
      return '' unless controller

      controller.send(
        :render_to_string,
        partial: 'redmine_project_explorer/sequence_diagram_assets'
      )
    end
  end
end
