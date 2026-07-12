class TicketTreeController < ApplicationController
  before_action :find_project
  before_action :authorize_issue_view

  def index
    issues = @project.issues
                     .visible(User.current)
                     .includes(:status)
                     .order(:id)
                     .to_a

    visible_issue_ids = issues.each_with_object({}) do |issue, ids|
      ids[issue.id] = true
    end

    @children_by_parent = Hash.new { |hash, key| hash[key] = [] }
    @root_issues = []

    issues.each do |issue|
      if issue.parent_id.present? && visible_issue_ids[issue.parent_id]
        @children_by_parent[issue.parent_id] << issue
      else
        @root_issues << issue
      end
    end
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
end
