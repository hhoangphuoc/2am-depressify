package com.twoam.companion.ui.theme

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * Small Step design tokens: paper-white ground, deep blue-green ink, system sans, pill primary
 * buttons, flat surfaces, 48 by 48 minimum touch targets. There are deliberately no status colours:
 * the Patient never sees a flag or a colour about themselves.
 *
 * The interface design document is not in the repository yet; these are the minimal tokens named in
 * the spec. Values are provisional and change here only.
 */
object SmallStepTokens {
    object Colors {
        /** Paper-white ground behind every screen. */
        val Paper = Color(0xFFF7F5F0)

        /** Flat surface for cards and the tab bar; separated by hairlines, not shadows. */
        val Surface = Color(0xFFFFFFFF)

        /** Deep blue-green ink for text and the primary action. */
        val Ink = Color(0xFF173F45)

        /** Secondary text. Still meets 4.5:1 contrast on Paper. */
        val InkMuted = Color(0xFF4D6A6E)

        /** Text and icons on an Ink-filled pill button. */
        val OnInk = Color(0xFFF7F5F0)

        /** Hairline dividers and outlines. */
        val Hairline = Color(0xFFD9DEDB)
    }

    object Size {
        /** Minimum touch target in both directions. */
        val MinTouchTarget = 48.dp
        val ScreenPadding = 24.dp
        val Gap = 16.dp
        val Hairline = 1.dp
    }

    object Type {
        val Title = 28.sp
        val Body = 17.sp
        val Label = 15.sp
    }
}
