Redmine::Plugin.register :redmine_project_explorer do
  name 'Redmine Project Explorer'
  author 'AI_Redmine Project'
  description 'Displays project issues as an interactive parent-child tree.'
  version '3.0.0'
  permission :view_ticket_tree, { ticket_tree: [:index, :export_html] }, public: true
  menu :project_menu, :ticket_tree,
       { controller: 'ticket_tree', action: 'index' },
       caption: 'チケットツリー', after: :issues, param: :project_id
end

require_relative 'app/services/redmine_project_explorer/html_exporter'
