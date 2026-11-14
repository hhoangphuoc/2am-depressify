package app.depressify.shared.voice

import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ShaderBrush
import androidx.compose.ui.graphics.asComposeShader
import org.jetbrains.skia.RuntimeEffect
import org.jetbrains.skia.RuntimeShaderBuilder

actual fun createCloudShader(): CloudShader? = runCatching { SkiaCloudShader() }.getOrNull()

private class SkiaCloudShader : CloudShader {
    private val builder = RuntimeShaderBuilder(RuntimeEffect.makeForShader(CloudSksl))

    override fun brush(width: Float, height: Float, time: Float, activity: Float, dim: Float, palette: List<Color>): Brush {
        builder.uniform("uRes", width, height)
        builder.uniform("uTime", time)
        builder.uniform("uAct", activity)
        builder.uniform("uDim", dim)
        listOf("uDeep", "uUpper", "uLower", "uLight").forEachIndexed { i, name ->
            val c = palette[i]
            builder.uniform(name, c.red, c.green, c.blue)
        }
        return ShaderBrush(builder.makeShader().asComposeShader())
    }
}
