require "test_helper"

class UsersControllerTest < ActionDispatch::IntegrationTest
  ##
  # test all routes which lead to this controller
  def test_routes
    assert_routing(
      { :path => "/user/new", :method => :get },
      { :controller => "users", :action => "new" }
    )

    assert_routing(
      { :path => "/user", :method => :post },
      { :controller => "users", :action => "create" }
    )

    assert_routing(
      { :path => "/user/go_public", :method => :post },
      { :controller => "users", :action => "go_public" }
    )

    assert_routing(
      { :path => "/user/suspended", :method => :get },
      { :controller => "users", :action => "suspended" }
    )

    assert_routing(
      { :path => "/user/username", :method => :get },
      { :controller => "users", :action => "show", :display_name => "username" }
    )
  end

  # The user creation page loads
  def test_new
    get new_user_path
    assert_redirected_to new_user_path(:cookie_test => "true")

    get new_user_path, :params => { :cookie_test => "true" }
    assert_response :success

    assert_no_match(/img-src \* data:;/, @response.headers["Content-Security-Policy-Report-Only"])

    assert_select "html", :count => 1 do
      assert_select "head", :count => 1 do
        assert_select "title", :text => /Sign Up/, :count => 1
      end
      assert_select "body", :count => 1 do
        assert_select "div#content", :count => 1 do
          assert_select "form[action='/user'][method='post']", :count => 1 do
            assert_select "input[id='user_email']", :count => 1
            assert_select "input[id='user_display_name']", :count => 1
            assert_select "input[id='user_pass_crypt'][type='password']", :count => 1
            assert_select "input[id='user_pass_crypt_confirmation'][type='password']", :count => 1
            assert_select "input[type='submit'][value='Sign Up']", :count => 1
          end
        end
      end
    end
  end

  def test_new_logged_in
    session_for(create(:user))

    get new_user_path
    assert_redirected_to root_path

    get new_user_path, :params => { :referer => "/test" }
    assert_redirected_to "/test"
  end

  def test_create_success
    user = build(:user, :pending)

    assert_difference "User.count", 1 do
      assert_difference "ActionMailer::Base.deliveries.size", 1 do
        perform_enqueued_jobs do
          post users_path, :params => { :user => user.attributes }
        end
      end
    end

    # Check the e-mail
    register_email = ActionMailer::Base.deliveries.first

    assert_equal register_email.to[0], user.email
    assert_match(/#{@url}/, register_email.body.to_s)

    # Check the page
    assert_redirected_to :controller => :confirmations, :action => :confirm, :display_name => user.display_name
  end

  def test_create_duplicate_email
    user = build(:user, :pending)
    create(:user, :email => user.email)

    assert_no_difference "User.count" do
      assert_no_difference "ActionMailer::Base.deliveries.size" do
        perform_enqueued_jobs do
          post users_path, :params => { :user => user.attributes }
        end
      end
    end

    assert_response :success
    assert_template "new"
    assert_select "form > div > input.is-invalid#user_email"
  end

  def test_create_duplicate_email_uppercase
    user = build(:user, :pending)
    create(:user, :email => user.email.upcase)

    assert_no_difference "User.count" do
      assert_no_difference "ActionMailer::Base.deliveries.size" do
        perform_enqueued_jobs do
          post users_path, :params => { :user => user.attributes }
        end
      end
    end

    assert_response :success
    assert_template "new"
    assert_select "form > div > input.is-invalid#user_email"
  end

  def test_create_duplicate_name
    user = build(:user, :pending)
    create(:user, :display_name => user.display_name)

    assert_no_difference "User.count" do
      assert_no_difference "ActionMailer::Base.deliveries.size" do
        perform_enqueued_jobs do
          post users_path, :params => { :user => user.attributes }
        end
      end
    end

    assert_response :success
    assert_template "new"
    assert_select "form > div > input.is-invalid#user_display_name"
  end

  def test_create_duplicate_name_uppercase
    user = build(:user, :pending)
    create(:user, :display_name => user.display_name.upcase)

    assert_no_difference "User.count" do
      assert_no_difference "ActionMailer::Base.deliveries.size" do
        perform_enqueued_jobs do
          post users_path, :params => { :user => user.attributes }
        end
      end
    end

    assert_response :success
    assert_template "new"
    assert_select "form > div > input.is-invalid#user_display_name"
  end

  def test_create_blocked_domain
    user = build(:user, :pending, :email => "user@example.net")

    # Now block that domain
    create(:acl, :domain => "example.net", :k => "no_account_creation")

    # Check that the second half of registration fails
    assert_no_difference "User.count" do
      assert_no_difference "ActionMailer::Base.deliveries.size" do
        perform_enqueued_jobs do
          post users_path, :params => { :user => user.attributes }
        end
      end
    end

    assert_response :success
    assert_template "blocked"
  end

  def test_create_referer_params
    user = build(:user, :pending)

    assert_difference "User.count", 1 do
      assert_difference "ActionMailer::Base.deliveries.size", 1 do
        post users_path, :params => { :user => user.attributes, :referer => "/edit?editor=id#map=1/2/3" }
        assert_enqueued_with :job => ActionMailer::MailDeliveryJob,
                             :args => proc { |args| args[3][:args][2] == welcome_path(:editor => "id", :zoom => 1, :lat => 2, :lon => 3) }
        perform_enqueued_jobs
      end
    end
  end

  def test_go_public
    user = create(:user, :data_public => false)
    session_for(user)

    post user_go_public_path

    assert_redirected_to account_path
    assert User.find(user.id).data_public
  end

  # Check that the user account page will display and contains some relevant
  # information for the user
  def test_show
    # Test a non-existent user
    get user_path("unknown")
    assert_response :not_found

    # Test a normal user
    user = create(:user)

    get user_path(user)
    assert_response :success
    assert_match(/img-src \* data:;/, @response.headers["Content-Security-Policy-Report-Only"])
    assert_select "div.content-heading" do
      assert_select "a[href^='/user/#{ERB::Util.u(user.display_name)}/history']", 1
      assert_select "a[href='/user/#{ERB::Util.u(user.display_name)}/traces']", 1
      assert_select "a[href='/user/#{ERB::Util.u(user.display_name)}/diary']", 1
      assert_select "a[href='/user/#{ERB::Util.u(user.display_name)}/diary_comments']", 1
      assert_select "a[href='/user/#{ERB::Util.u(user.display_name)}/account']", 0
      assert_select "a[href='/user/#{ERB::Util.u(user.display_name)}/blocks']", 0
      assert_select "a[href='/user/#{ERB::Util.u(user.display_name)}/blocks_by']", 0
      assert_select "a[href='/user_blocks/new/#{ERB::Util.u(user.display_name)}']", 0
    end

    # Test a user who has been blocked
    blocked_user = create(:user)
    create(:user_block, :user => blocked_user)
    get user_path(blocked_user)
    assert_response :success
    assert_select "div.content-heading" do
      assert_select "a[href^='/user/#{ERB::Util.u(blocked_user.display_name)}/history']", 1
      assert_select "a[href='/user/#{ERB::Util.u(blocked_user.display_name)}/traces']", 1
      assert_select "a[href='/user/#{ERB::Util.u(blocked_user.display_name)}/diary']", 1
      assert_select "a[href='/user/#{ERB::Util.u(blocked_user.display_name)}/diary_comments']", 1
      assert_select "a[href='/user/#{ERB::Util.u(blocked_user.display_name)}/account']", 0
      assert_select "a[href='/user/#{ERB::Util.u(blocked_user.display_name)}/blocks']", 1
      assert_select "a[href='/user/#{ERB::Util.u(blocked_user.display_name)}/blocks_by']", 0
      assert_select "a[href='/user_blocks/new/#{ERB::Util.u(blocked_user.display_name)}']", 0
    end

    # Test a moderator who has applied blocks
    moderator_user = create(:moderator_user)
    create(:user_block, :creator => moderator_user)
    get user_path(moderator_user)
    assert_response :success
    assert_select "div.content-heading" do
      assert_select "a[href^='/user/#{ERB::Util.u(moderator_user.display_name)}/history']", 1
      assert_select "a[href='/user/#{ERB::Util.u(moderator_user.display_name)}/traces']", 1
      assert_select "a[href='/user/#{ERB::Util.u(moderator_user.display_name)}/diary']", 1
      assert_select "a[href='/user/#{ERB::Util.u(moderator_user.display_name)}/diary_comments']", 1
      assert_select "a[href='/account']", 0
      assert_select "a[href='/user/#{ERB::Util.u(moderator_user.display_name)}/blocks']", 0
      assert_select "a[href='/user/#{ERB::Util.u(moderator_user.display_name)}/blocks_by']", 1
      assert_select "a[href='/user_blocks/new/#{ERB::Util.u(moderator_user.display_name)}']", 0
    end

    # Login as a normal user
    session_for(user)

    # Test the normal user
    get user_path(user)
    assert_response :success
    assert_select "div.content-heading" do
      assert_select "a[href^='/user/#{ERB::Util.u(user.display_name)}/history']", 1
      assert_select "a[href='/traces/mine']", 1
      assert_select "a[href='/user/#{ERB::Util.u(user.display_name)}/diary']", 1
      assert_select "a[href='/user/#{ERB::Util.u(user.display_name)}/diary_comments']", 1
      assert_select "a[href='/account']", 1
      assert_select "a[href='/user/#{ERB::Util.u(user.display_name)}/blocks']", 0
      assert_select "a[href='/user/#{ERB::Util.u(user.display_name)}/blocks_by']", 0
      assert_select "a[href='/user_blocks/new/#{ERB::Util.u(user.display_name)}']", 0
      assert_select "a[href='/api/0.6/user/#{ERB::Util.u(user.id)}']", 0
    end

    # Login as a moderator
    session_for(create(:moderator_user))

    # Test the normal user
    get user_path(user)
    assert_response :success
    assert_select "div.content-heading" do
      assert_select "a[href^='/user/#{ERB::Util.u(user.display_name)}/history']", 1
      assert_select "a[href='/user/#{ERB::Util.u(user.display_name)}/traces']", 1
      assert_select "a[href='/user/#{ERB::Util.u(user.display_name)}/diary']", 1
      assert_select "a[href='/user/#{ERB::Util.u(user.display_name)}/diary_comments']", 1
      assert_select "a[href='/account']", 0
      assert_select "a[href='/user/#{ERB::Util.u(user.display_name)}/blocks']", 0
      assert_select "a[href='/user/#{ERB::Util.u(user.display_name)}/blocks_by']", 0
      assert_select "a[href='/user_blocks/new/#{ERB::Util.u(user.display_name)}']", 1
      assert_select "a[href='/api/0.6/user/#{ERB::Util.u(user.id)}']", 1
    end
  end

  # Test whether information about contributor terms is shown for users who haven't agreed
  def test_terms_not_agreed
    agreed_user = create(:user, :terms_agreed => 3.days.ago)
    seen_user = create(:user, :terms_seen => true, :terms_agreed => nil)
    not_seen_user = create(:user, :terms_seen => false, :terms_agreed => nil)

    get user_path(agreed_user)
    assert_response :success
    assert_select "div.content-heading" do
      assert_select "dt", :count => 0, :text => /Contributor terms/
    end

    get user_path(seen_user)
    assert_response :success
    assert_select "div.content-heading" do
      assert_select "dt", :count => 1, :text => /Contributor terms/
      assert_select "dd", /Declined/
    end

    get user_path(not_seen_user)
    assert_response :success
    assert_select "div.content-heading" do
      assert_select "dt", :count => 1, :text => /Contributor terms/
      assert_select "dd", /Undecided/
    end
  end

  def test_auth_failure_callback
    get auth_failure_path
    assert_redirected_to login_path

    get auth_failure_path, :params => { :origin => "/" }
    assert_redirected_to root_path

    get auth_failure_path, :params => { :origin => "http://www.google.com" }
    assert_redirected_to login_path
  end

  def test_show_heatmap_data
    user = create(:user)
    # Create two changesets
    create(:changeset, :user => user, :created_at => 6.months.ago, :num_changes => 10)
    create(:changeset, :user => user, :created_at => 3.months.ago, :num_changes => 20)

    get user_path(user)
    assert_response :success
    # The data should not be empty
    heatmap_data = assigns(:heatmap_data)
    assert_not_nil heatmap_data
    assert_predicate heatmap_data[:data], :any?
    # The data should be in the right format
    assert(heatmap_data[:data].values.all? { |entry| entry[:date] && entry[:total_changes] }, "Heatmap data should have :date and :total_changes keys")
    assert_equal 30, heatmap_data[:count]
  end

  def test_show_heatmap_data_caching
    # Enable caching to be able to test
    Rails.cache.clear
    @original_cache_store = Rails.cache
    Rails.cache = ActiveSupport::Cache::MemoryStore.new

    user = create(:user)

    # Create an initial changeset
    create(:changeset, :user => user, :created_at => 6.months.ago, :num_changes => 15)

    # First request to populate the cache
    get user_path(user)
    first_response_data = assigns(:heatmap_data)
    assert_not_nil first_response_data, "Expected heatmap data to be assigned on the first request"
    assert_equal 1, first_response_data[:data].values.count { |day| day[:total_changes].positive? }, "Expected one entry in the heatmap data"

    # Inspect cache after the first request
    cached_data = Rails.cache.read("heatmap_data_of_user_#{user.id}")
    assert_equal first_response_data, cached_data, "Expected the cache to contain the first response data"

    # Add a new changeset to the database
    create(:changeset, :user => user, :created_at => 3.months.ago, :num_changes => 20)

    # Second request
    get user_path(user)
    second_response_data = assigns(:heatmap_data)

    # Confirm that the cache is still being used
    assert_equal first_response_data, second_response_data, "Expected cached data to be returned on the second request"

    # Clear the cache and make a third request to confirm new data is retrieved
    Rails.cache.clear
    get user_path(user)
    third_response_data = assigns(:heatmap_data)

    # Ensure the new entry is now included
    assert_equal 2, third_response_data[:data].values.count { |day| day[:total_changes].positive? }, "Expected two entries in the heatmap data after clearing the cache"

    # Reset caching config to defaults
    Rails.cache.clear
    Rails.cache = @original_cache_store
  end

  def test_show_heatmap_data_no_changesets
    user = create(:user)

    get user_path(user)
    assert_response :success
    assert_empty(assigns(:heatmap_data)[:data].values)
    assert_select ".heatmap", :count => 0
  end

  def test_heatmap_rendering
    # Test user with no changesets
    user_without_changesets = create(:user)
    get user_path(user_without_changesets)
    assert_response :success
    assert_select ".heatmap", 0

    # Test user with changesets
    user_with_changesets = create(:user)
    changeset39 = create(:changeset, :user => user_with_changesets, :created_at => 4.months.ago.beginning_of_day, :num_changes => 39)
    _changeset5 = create(:changeset, :user => user_with_changesets, :created_at => 3.months.ago.beginning_of_day, :num_changes => 5)
    changeset11 = create(:changeset, :user => user_with_changesets, :created_at => 3.months.ago.beginning_of_day, :num_changes => 11)
    get user_path(user_with_changesets)
    assert_response :success
    assert_select ".heatmap a", 2

    history_path = user_history_path(user_with_changesets)
    assert_select ".heatmap a[data-date='#{4.months.ago.to_date}'][data-count='39'][href='#{history_path}?before=#{changeset39.id + 1}']"
    assert_select ".heatmap a[data-date='#{3.months.ago.to_date}'][data-count='16'][href='#{history_path}?before=#{changeset11.id + 1}']"
    assert_select ".heatmap [data-date='#{5.months.ago.to_date}']:not([data-count])"
  end

  def test_heatmap_headline_changset_zero
    user = create(:user)

    get user_path(user)

    assert_response :success
    assert_select "h2.text-body-secondary.fs-5", :count => 0
  end

  def test_heatmap_headline_changeset_singular
    user = create(:user)
    create(:changeset, :user => user, :created_at => 4.months.ago.beginning_of_day, :num_changes => 1)

    get user_path(user)

    assert_response :success
    assert_select "h2.text-body-secondary.fs-5", :text => "1 contribution in the last year"
  end

  def test_heatmap_headline_changeset_plural
    user = create(:user)
    create(:changeset, :user => user, :created_at => 4.months.ago.beginning_of_day, :num_changes => 12)

    get user_path(user)

    assert_response :success
    assert_select "h2.text-body-secondary.fs-5", :text => "12 contributions in the last year"
  end

  def test_show_profile_diaries
    user = create(:user)
    create(:language, :code => "en")
    create(:diary_entry, :user => user, :title => "First Entry", :body => "First body")
    create(:diary_entry, :user => user, :title => "Second Entry", :body => "Second body")
    create(:diary_entry, :user => user, :title => "Third Entry", :body => "Third body")
    create(:diary_entry, :user => user, :title => "Fourth Entry", :body => "Fourth body")
    create(:diary_entry, :user => user, :title => "Fifth Entry", :body => "Fifth body")

    get user_path(user)
    assert_response :success

    # Should only show the 4 most recent entries
    assert_select ".profile-diary-card", 4
    assert_select ".card-title", "Fifth Entry"
    assert_select ".card-title", "Fourth Entry"
    assert_select ".card-title", "Third Entry"
    assert_select ".card-title", "Second Entry"
    assert_select ".card-title", { :text => "First Entry", :count => 0 }
  end

  def test_show_profile_diaries_with_comments
    user = create(:user)
    create(:language, :code => "en")
    entry = create(:diary_entry, :user => user, :title => "Entry with Comments")
    create(:diary_comment, :diary_entry => entry)
    create(:diary_comment, :diary_entry => entry)

    get user_path(user)
    assert_response :success

    assert_select ".profile-diary-card" do
      assert_select ".card-title", "Entry with Comments"
      assert_select "small.text-body-secondary", /2 comments/
    end
  end

  def test_show_profile_diaries_empty
    user = create(:user)
    get user_path(user)
    assert_response :success
    assert_select ".profile-diary-card", 0
  end
end
