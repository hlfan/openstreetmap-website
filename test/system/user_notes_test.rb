# frozen_string_literal: true

require "application_system_test_case"

class UserNotesTest < ApplicationSystemTestCase
  test "note status icons have accessible names" do
    user = create(:user)
    open_note = create(:note, :author => user)
    create(:note_comment, :event => "opened", :note => open_note, :author => user)
    closed_note = create(:note, :closed, :author => user)
    create(:note_comment, :event => "opened", :note => closed_note, :author => user)
    hidden_note = create(:note, :status => "hidden", :author => user)
    create(:note_comment, :event => "opened", :note => hidden_note, :author => user)

    sign_in_as(create(:moderator_user))
    visit user_notes_path(user)

    assert_selector "nav[aria-label='Page navigation']", :count => 2
    { open_note => %w[Unresolved exclam], closed_note => %w[Resolved tick], hidden_note => %w[Hidden minus] }.each do |note, (label, icon)|
      row = find(".note_list a[href='#{note_path(note)}']").find(:xpath, "./ancestor::tr")
      row.assert_selector "svg title", :text => label, :visible => :all
      row.assert_selector "svg use[href='#pin-#{icon}']", :visible => :all
    end
    assert_selector "svg defs #pin-exclam", :visible => :all
    assert_selector "svg[width='0'][height='0'][aria-hidden='true']", :visible => :all
  end

  test "boundary condition when next page link activates" do
    user = create(:user)
    ("A".."J").each do |x|
      create(:note, :author => user, :description => "Note '#{x}'") do |note|
        create(:note_comment, :event => "opened", :note => note, :author => user, :body => "Note '#{x}'")
      end
    end

    visit user_notes_path(user)

    within_content_body do
      assert_text "Note 'J'"
      assert_text "Note 'A'"
      assert_no_link "Previous"
      assert_no_link "Next"
    end

    ("K".."K").each do |x|
      create(:note, :author => user, :description => "Note '#{x}'") do |note|
        create(:note_comment, :event => "opened", :note => note, :author => user, :body => "Note '#{x}'")
      end
    end

    visit user_notes_path(user)

    within_content_body do
      assert_text "Note 'K'"
      assert_text "Note 'B'"
      assert_no_text "Note 'A'"
      assert_no_link "Previous"
      assert_link "Next"

      click_on "Next", :match => :first

      assert_no_text "Note 'K'"
      assert_no_text "Note 'B'"
      assert_text "Note 'A'"
      assert_link "Previous"
      assert_no_link "Next"
    end
  end
end
