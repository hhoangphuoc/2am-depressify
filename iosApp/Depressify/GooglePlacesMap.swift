import GoogleMaps
import Shared
import UIKit

/// Today's places on a Google map, for the shared Compose card. Kotlin cannot link the Maps SDK for
/// iOS, so the app registers this with `NativeMaps` at launch (iOSApp.swift) when it has a key.
/// A preview inside a scrolling card: only the pins respond to touch.
final class GooglePlacesMap: UIView, @preconcurrency NativePlacesMap, @preconcurrency GMSMapViewDelegate {
    private static let ink = UIColor(red: 0x23 / 255, green: 0x3C / 255, blue: 0x4C / 255, alpha: 1)
    private static let accent = UIColor(red: 0x32 / 255, green: 0x6B / 255, blue: 0x73 / 255, alpha: 1)
    private static let border = UIColor(red: 0xD7 / 255, green: 0xDD / 255, blue: 0xE0 / 255, alpha: 1)
    private static let youBlue = UIColor(red: 0x2F / 255, green: 0x6F / 255, blue: 0xD6 / 255, alpha: 1)

    private let map = GMSMapView(options: GMSMapViewOptions())
    private var onSelect: (any PlaceSelection)?
    private var area: GMSCoordinateBounds?
    private var areaKey = ""
    private var fitted = ("", CGSize.zero)

    override init(frame: CGRect) {
        super.init(frame: frame)
        map.frame = bounds
        map.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        map.mapStyle = try? GMSMapStyle(jsonString: PlacesMapKt.CALM_MAP_STYLE)
        map.settings.setAllGesturesEnabled(false)
        map.delegate = self
        map.accessibilityLabel = "Map of places near you"
        addSubview(map)
    }

    required init?(coder: NSCoder) { nil }

    var view: UIView { self }

    func show(places: [MapPlace], near: MapPlace?, selected: Int32, symbol: String, onSelect: any PlaceSelection) {
        self.onSelect = onSelect
        map.clear()
        var area = GMSCoordinateBounds()
        if let near {
            let you = GMSMarker(position: near.coordinate)
            you.iconView = Self.youDot()
            you.groundAnchor = CGPoint(x: 0.5, y: 0.5)
            you.title = near.name
            you.zIndex = 0
            you.map = map
            area = area.includingCoordinate(near.coordinate)
        }
        for (i, place) in places.enumerated() {
            let on = i == Int(selected)
            let pin = GMSMarker(position: place.coordinate)
            pin.iconView = Self.pin(symbol: symbol, on: on)
            pin.groundAnchor = CGPoint(x: 0.5, y: 0.5)
            pin.title = place.name
            pin.userData = i
            pin.zIndex = on ? 2 : 1
            pin.map = map
            area = area.includingCoordinate(place.coordinate)
        }
        self.area = area
        areaKey = places.map { "\($0.latitude),\($0.longitude)" }.joined(separator: ";") + "|\(near?.latitude ?? 0),\(near?.longitude ?? 0)"
        setNeedsLayout()
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        // Fit once per set of places and size: choosing a pin leaves the map still.
        guard let area, bounds.width > 0, fitted != (areaKey, bounds.size) else { return }
        fitted = (areaKey, bounds.size)
        if area.northEast.latitude == area.southWest.latitude && area.northEast.longitude == area.southWest.longitude {
            map.camera = GMSCameraPosition(target: area.northEast, zoom: 15)
        } else {
            map.moveCamera(GMSCameraUpdate.fit(area, withPadding: 56))
        }
    }

    func mapView(_ mapView: GMSMapView, didTap marker: GMSMarker) -> Bool {
        if let i = marker.userData as? Int { onSelect?.select(index: Int32(i)) }
        return true
    }

    /// A round tile with the place's symbol; the chosen one is larger and filled with ink.
    private static func pin(symbol: String, on: Bool) -> UIView {
        let size: CGFloat = on ? 44 : 34
        let tile = UIView(frame: CGRect(x: 0, y: 0, width: size, height: size))
        tile.backgroundColor = on ? ink : .white
        tile.layer.cornerRadius = size / 2
        tile.layer.borderWidth = 2
        tile.layer.borderColor = (on ? UIColor.white : border).cgColor
        let config = UIImage.SymbolConfiguration(pointSize: on ? 19 : 15, weight: .semibold)
        let icon = UIImageView(image: UIImage(systemName: symbol, withConfiguration: config))
        icon.tintColor = on ? .white : accent
        icon.center = CGPoint(x: size / 2, y: size / 2)
        tile.addSubview(icon)
        return tile
    }

    private static func youDot() -> UIView {
        let dot = UIView(frame: CGRect(x: 0, y: 0, width: 18, height: 18))
        dot.backgroundColor = youBlue
        dot.layer.cornerRadius = 9
        dot.layer.borderWidth = 3
        dot.layer.borderColor = UIColor.white.cgColor
        return dot
    }
}

private extension MapPlace {
    var coordinate: CLLocationCoordinate2D { CLLocationCoordinate2D(latitude: latitude, longitude: longitude) }
}

