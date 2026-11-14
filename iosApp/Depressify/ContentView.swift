import Shared
import SwiftUI
import UIKit

struct ContentView: View {
    // Compose picks the night theme from local time; SwiftUI mirrors it so the status bar stays readable.
    @State private var night = false

    var body: some View {
        ComposeView { night = $0 }
            .ignoresSafeArea() // The shared layout handles safe-area and keyboard insets itself.
            .preferredColorScheme(night ? .dark : .light)
    }
}

struct ComposeView: UIViewControllerRepresentable {
    let onNightChange: (Bool) -> Void

    func makeUIViewController(context: Context) -> UIViewController {
        MainViewControllerKt.MainViewController { night in onNightChange(night.boolValue) }
    }

    func updateUIViewController(_ uiViewController: UIViewController, context: Context) {}
}
