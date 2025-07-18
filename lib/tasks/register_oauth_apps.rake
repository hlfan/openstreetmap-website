namespace :oauth do
  desc "Register the built-in apps with specified user as owner; append necessary changes to settings file"
  task :register_apps, [:display_name] => :environment do |task, args|
    already_defined_keys = [:id_application, :oauth_application, :oauth_key] & Settings.keys
    settings_filename = Rails.root.join("config/settings.local.yml")
    settings_file_exists = File.file?(settings_filename)

    unless already_defined_keys.empty?
      if settings_file_exists
        puts "The following settings are already defined (likely in #{settings_filename}):"
      else
        puts "The following settings are already defined:"
      end
      already_defined_keys.each do |key|
        puts "- #{key}"
      end
      puts ""
      puts "Delete or comment them out to proceed."

      raise "App settings already defined"
    end

    user = User.find_by! :display_name => args.display_name

    model = Doorkeeper.config.application_model

    id_application = model.create :name => "Local iD",
                                  :redirect_uri => "http://localhost:3000",
                                  :scopes => %w[read_prefs write_prefs write_api read_gpx write_gpx write_notes],
                                  :confidential => false,
                                  :owner => user

    web_application = model.create :name => "OpenStreetMap Web Site",
                                   :redirect_uri => "http://localhost:3000",
                                   :scopes => %w[write_api write_notes],
                                   :owner => user

    File.open settings_filename, "a" do |file|
      file << "\n" if settings_file_exists
      file << <<~CUT
        # generated by #{task} rake task
        # OAuth 2 Client ID for iD
        id_application: "#{id_application.uid}"
        # OAuth 2 Client ID for the web site
        oauth_application: "#{web_application.uid}"
        # OAuth 2 Client Secret for the web site
        oauth_key: "#{web_application.plaintext_secret}"
      CUT
    end

    puts "Updated settings in #{settings_filename}"
  end
end
