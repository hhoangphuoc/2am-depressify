package app.depressify.shared.voice

import android.graphics.RuntimeShader
import android.os.Build
import androidx.annotation.RequiresApi
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ShaderBrush

// AGSL runtime shaders need Android 13 (API 33); older phones use the gradient fallback.
actual fun createCloudShader(): CloudShader? =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) AgslCloudShader() else null

@RequiresApi(Build.VERSION_CODES.TIRAMISU)
private class AgslCloudShader : CloudShader {
    private val shader = RuntimeShader(CloudSksl)
    private val brush = ShaderBrush(shader)

    override fun brush(width: Float, height: Float, time: Float, activity: Float, dim: Float, palette: List<Color>): Brush {
        shader.setFloatUniform("uRes", width, height)
        shader.setFloatUniform("uTime", time)
        shader.setFloatUniform("uAct", activity)
        shader.setFloatUniform("uDim", dim)
        listOf("uDeep", "uUpper", "uLower", "uLight").forEachIndexed { i, name ->
            val c = palette[i]
            shader.setFloatUniform(name, c.red, c.green, c.blue)
        }
        return brush
    }
}
