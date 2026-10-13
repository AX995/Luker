package com.luker.app

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import java.io.File
import java.nio.file.Files
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(manifest = Config.NONE, assetDir = "runtime-assets")
class ServerPluginRuntimeLifecycleTest {
    @Test fun runtimePreparationPreservesPluginsOnRestartAndRefresh() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val assetsPath = File(javaClass.classLoader!!.getResource("runtime-assets")!!.toURI())
        val assetArchive = File(context.cacheDir, "runtime-assets.apk")
        ZipOutputStream(assetArchive.outputStream()).use { zip ->
            assetsPath.walkTopDown().filter { it.isFile }.forEach { file ->
                zip.putNextEntry(ZipEntry("assets/" + file.relativeTo(assetsPath).invariantSeparatorsPath))
                zip.write(file.readBytes())
                zip.closeEntry()
            }
        }
        context.assets.javaClass.getMethod("addAssetPath", String::class.java)
            .invoke(context.assets, assetArchive.absolutePath)
        val runtime = File(context.filesDir, "luker-runtime")
        val plugins = File(context.getExternalFilesDir(null), "luker-data/plugins")
        val entry = File(plugins, "demo/index.js")
        entry.parentFile!!.mkdirs()
        entry.writeText("persistent-plugin")
        val prepare = LukerRuntimeManager::class.java.getDeclaredMethod("prepareRuntime", Context::class.java)
        prepare.isAccessible = true
        try {
            prepare.invoke(LukerRuntimeManager, context)
            prepare.invoke(LukerRuntimeManager, context)
            assertEquals("persistent-plugin", entry.readText())
            File(runtime, ".runtime-version").writeText("old-version")
            File(runtime, "obsolete").writeText("old")
            prepare.invoke(LukerRuntimeManager, context)
            assertFalse(File(runtime, "obsolete").exists())
            assertEquals("persistent-plugin", entry.readText())
            assertTrue(Files.isSymbolicLink(File(runtime, "_server-plugins").toPath()))
            assertEquals(plugins.canonicalFile, File(runtime, "_server-plugins").canonicalFile)
        } finally {
            ServerPluginRuntime.detach(runtime)
        }
    }
}
