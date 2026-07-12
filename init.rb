Redmine::Plugin.register :redmine_project_explorer do
  name 'Redmine Project Explorer'
  author 'AI_Redmine Project'
  description 'Displays project issues as a parent-child ticket tree.'
  version '1.0.0'

  permission :view_ticket_tree,
             { ticket_tree: [:index] },
             public: true

  menu :project_menu,
       :ticket_tree,
       { controller: 'ticket_tree', action: 'index' },
       caption: 'チケットツリー',
       after: :issues,
       param: :project_id
end
