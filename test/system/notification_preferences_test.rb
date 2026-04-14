# frozen_string_literal: true

require "application_system_test_case"

class NotificationPreferencesTest < ApplicationSystemTestCase
  test "toggling preferences" do
    user = create(:user)
    sign_in_as(user)

    visit notification_preferences_path

    assert_selector ".notification_preferences input:checked", :count => 7

    uncheck "user_notification_preferences_new_follower_email"
    uncheck "user_notification_preferences_gpx_import_success_email"
    click_on "Update Preferences"

    assert_selector ".notification_preferences input:checked", :count => 5
    assert_selector "input#user_notification_preferences_new_follower_email:not(checked)"
  end
end
