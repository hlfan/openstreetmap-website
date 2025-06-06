require "application_system_test_case"

class ReportDiaryCommentTest < ApplicationSystemTestCase
  def setup
    create(:language, :code => "en")
    @diary_entry = create(:diary_entry)
    @comment = create(:diary_comment, :diary_entry => @diary_entry)
  end

  def test_no_link_when_not_logged_in
    visit diary_entry_path(@diary_entry.user, @diary_entry)
    assert_content @comment.body

    assert_no_content I18n.t("diary_entries.diary_comment.report")
  end

  def test_it_works
    sign_in_as(create(:user))
    visit diary_entry_path(@diary_entry.user, @diary_entry)
    assert_content @diary_entry.title

    click_on I18n.t("diary_entries.diary_comment.report")
    assert_content "Report"
    assert_content I18n.t("reports.new.disclaimer.intro")

    choose I18n.t("reports.new.categories.diary_comment.spam_label")
    fill_in "report_details", :with => "This comment is spam"
    assert_difference "Issue.count", 1 do
      click_on "Create Report"
    end

    assert_content "Your report has been registered successfully"

    assert_equal @comment, Issue.last.reportable
    assert_equal "administrator", Issue.last.assigned_role
  end
end
