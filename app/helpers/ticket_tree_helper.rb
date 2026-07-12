module TicketTreeHelper
  def render_ticket_tree_node(issue, children_by_parent)
    children = children_by_parent[issue.id]

    issue_link = link_to(
      "##{issue.id} #{issue.subject}",
      issue_path(issue),
      class: 'ticket-tree-link'
    )

    status = content_tag(
      :span,
      issue.status.name,
      class: 'ticket-tree-status'
    )

    ticket_line = content_tag(
      :span,
      safe_join([issue_link, status], ' ')
    )

    content_tag(:li, class: 'ticket-tree-node') do
      if children.any?
        content_tag(:details, open: true) do
          safe_join([
            content_tag(:summary, ticket_line),
            content_tag(
              :ul,
              safe_join(
                children.map do |child|
                  render_ticket_tree_node(child, children_by_parent)
                end
              ),
              class: 'ticket-tree-list'
            )
          ])
        end
      else
        content_tag(:div, ticket_line, class: 'ticket-tree-leaf')
      end
    end
  end
end
