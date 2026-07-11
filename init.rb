Redmine::Plugin.register :redmine_ticket_tree do
  name 'Redmine Ticket Tree'
  author 'AI_Redmine Project'
  description 'Adds a minimal ticket tree page to each project.'
  version '0.2.0'

  menu :project_menu,
       :ticket_tree,
       { controller: 'ticket_tree', action: 'index' },
       caption: 'チケットツリー',
       after: :issues,
       param: :project_id
end
