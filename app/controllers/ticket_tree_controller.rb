class TicketTreeController < ApplicationController
  before_action :find_project
  before_action :check_permission

  def index
  end

  private

  def find_project
    @project = Project.find(params[:project_id])
  rescue ActiveRecord::RecordNotFound
    render_404
  end

  def check_permission
    deny_access unless User.current.allowed_to?(:view_issues, @project)
  end
end
