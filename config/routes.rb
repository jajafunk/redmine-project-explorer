get 'projects/:project_id/ticket_tree',
    to: 'ticket_tree#index',
    as: 'project_ticket_tree'

post 'projects/:project_id/ticket_tree/:issue_id/export_html',
     to: 'ticket_tree#export_html',
     as: 'export_project_ticket_tree_html'
