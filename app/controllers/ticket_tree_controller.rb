class TicketTreeController < ApplicationController
  before_action :find_project
  before_action :authorize_issue_view
  SORT_OPTIONS = %w[tree id updated priority assignee].freeze

  def index
    @sort = SORT_OPTIONS.include?(params[:sort]) ? params[:sort] : 'tree'
    issues = @project.issues.visible(User.current)
                     .includes(:status, :priority, :assigned_to).to_a
    visible_ids = issues.index_by(&:id)
    @children_by_parent = Hash.new { |h, k| h[k] = [] }
    @root_issues = []
    issues.each do |issue|
      if issue.parent_id.present? && visible_ids.key?(issue.parent_id)
        @children_by_parent[issue.parent_id] << issue
      else
        @root_issues << issue
      end
    end
    @root_issues.sort_by! { |issue| issue_sort_key(issue) }
    @children_by_parent.each_value { |children| children.sort_by! { |issue| issue_sort_key(issue) } }
  end

  private

  def find_project
    @project = Project.find(params[:project_id])
  rescue ActiveRecord::RecordNotFound
    render_404
  end

  def authorize_issue_view
    deny_access unless User.current.allowed_to?(:view_issues, @project)
  end

  def issue_sort_key(issue)
    case @sort
    when 'id'       then [issue.id]
    when 'updated'  then [-issue.updated_on.to_i, issue.id]
    when 'priority' then [-(issue.priority&.position || 0), issue.id]
    when 'assignee' then [(issue.assigned_to&.name || '').downcase, issue.id]
    else [issue.root_id || issue.id, issue.lft || issue.id, issue.id]
    end
  end
end
