module TicketTreeHelper
  def render_ticket_tree_node(issue, children_by_parent)
    children = children_by_parent[issue.id]
    link = link_to("##{issue.id} #{issue.subject}", issue_path(issue), class: 'ticket-tree-link')
    status = content_tag(:span, issue.status.name,
      class: "ticket-tree-badge #{ticket_tree_status_class(issue)}")
    priority = content_tag(:span,
      "#{ticket_tree_priority_icon(issue.priority)} #{issue.priority&.name}",
      class: 'ticket-tree-priority', title: "優先度: #{issue.priority&.name}")
    meta = []
    meta << content_tag(:span, "担当: #{issue.assigned_to.name}") if issue.assigned_to
    meta << content_tag(:span, "進捗: #{issue.done_ratio}%")
    meta << content_tag(:span, "更新: #{format_time(issue.updated_on)}")
    body = safe_join([
      content_tag(:span, safe_join([link, status, priority], ' '), class: 'ticket-tree-title-line'),
      content_tag(:span, safe_join(meta, ' · '), class: 'ticket-tree-meta')
    ])
    data = {
      issue_id: issue.id, issue_url: issue_path(issue),
      export_url: export_project_ticket_tree_html_path(@project, issue),
      edit_url: (edit_issue_path(issue) if User.current.allowed_to?(:edit_issues, @project)),
      child_url: (new_project_issue_path(@project, issue: { parent_issue_id: issue.id }) if User.current.allowed_to?(:add_issues, @project)),
      search_text: [issue.id, issue.subject, issue.status.name, issue.priority&.name, issue.assigned_to&.name].compact.join(' ').downcase
    }
    content_tag(:li, class: 'ticket-tree-node', data: data) do
      if children.any?
        content_tag(:details, id: "ticket-tree-issue-#{issue.id}", open: true) do
          safe_join([
            content_tag(:summary, body),
            content_tag(:ul, safe_join(children.map { |child| render_ticket_tree_node(child, children_by_parent) }), class: 'ticket-tree-list')
          ])
        end
      else
        content_tag(:div, body, class: 'ticket-tree-leaf')
      end
    end
  end

  def ticket_tree_status_class(issue)
    return 'ticket-tree-status-closed' if issue.status.is_closed?
    "ticket-tree-status-#{issue.status.id % 6}"
  end

  def ticket_tree_priority_icon(priority)
    case priority&.name.to_s
    when /緊急|即時|urgent|immediate/i then '🔥'
    when /高|high/i then '▲'
    when /低|low/i then '▽'
    else '●'
    end
  end
end
