# frozen_string_literal: true

module MapLayers
  def self.full_definitions(layers_filename, legends: nil)
    legended_layers = YAML.load_file(Rails.root.join(legends)).keys if legends
    YAML.load_file(Rails.root.join(layers_filename))
        .reject { |layer| layer["apiKeyId"] && !Settings[layer["apiKeyId"]] }
        .map do |layer|
          if layer["apiKeyId"]
            layer["apikey"] = Settings[layer["apiKeyId"]]
            layer.delete "apiKeyId"
          end
          if layer["isVectorStyle"]
            layer["style"] = style_from_style_url(layer, "styleUrl")
            layer["styleDark"] = style_from_style_url(layer, "styleUrlDark") if layer["styleUrlDark"]
          else
            layer["style"] = style_from_tile_url(layer, "tileUrl")
            layer["styleDark"] = style_from_tile_url(layer, "tileUrlDark") if layer["tileUrlDark"]
          end
          layer["hasLegend"] = true if legended_layers&.include?(layer["layerId"])
          layer.delete "styleUrl"
          layer.delete "styleUrlDark"
          layer.delete "tileUrl"
          layer.delete "tileUrlDark"
          layer
        end
  end

  def self.embed_definitions(layers_filename)
    full_definitions(layers_filename)
      .select { |entry| entry["canEmbed"] }
      .to_h { |entry| [entry["layerId"], entry.slice("leafletOsmId", "leafletOsmDarkId", "apikey").compact] }
  end

  def self.style_from_style_url(layer, key)
    layer[key].sub("{apikey}", layer["apikey"] || "")
  end

  def self.style_from_tile_url(layer, key)
    url_template = layer[key]
                   .sub("{r}", "{ratio}")
                   .sub("{apikey}", layer["apikey"] || "")

    # {switch:a,b,c} for DNS server multiplexing
    switch_regex = /\{switch:([^}]+)\}/
    match = url_template.match(switch_regex)

    tiles = if match
              match[1]
                .split(",")
                .map { |server| url_template.sub(switch_regex, server) }
            else
              [url_template]
            end

    {
      :version => 8,
      :sources => {
        "raster-tiles-#{layer['layerId']}" => {
          :type => "raster",
          :tiles => tiles,
          :tileSize => 256,
          :maxZoom => layer["maxZoom"]
        }
      },
      :layers => [
        {
          :id => "raster-tiles-layer-#{layer['layerId']}",
          :type => "raster",
          :source => "raster-tiles-#{layer['layerId']}"
        }
      ]
    }
  end
end
