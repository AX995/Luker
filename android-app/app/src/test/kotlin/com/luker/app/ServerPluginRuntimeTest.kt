package com.luker.app

import java.io.File
import java.nio.file.Files
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class ServerPluginRuntimeTest {
    @get:Rule val temporary = TemporaryFolder()

    @Test fun refreshAndRestartPreservePluginFiles() {
        val runtime = temporary.newFolder("runtime")
        val plugins = temporary.newFolder("data", "plugins")
        val entry = File(plugins, "demo/index.js")
        entry.parentFile!!.mkdirs()
        entry.writeText("module.exports = 42")
        ServerPluginRuntime.prepare(runtime, plugins)
        ServerPluginRuntime.prepare(runtime, plugins)
        assertEquals(entry.readText(), File(runtime, "_server-plugins/demo/index.js").readText())
        ServerPluginRuntime.detach(runtime)
        runtime.deleteRecursively()
        assertEquals("module.exports = 42", entry.readText())
        runtime.mkdirs()
        ServerPluginRuntime.prepare(runtime, plugins)
        assertEquals(entry.readText(), File(runtime, "_server-plugins/demo/index.js").readText())
        ServerPluginRuntime.detach(runtime)
    }

    @Test fun replacesDanglingAndChangedTargetsWithoutDeletingThem() {
        val runtime = temporary.newFolder("runtime")
        val first = temporary.newFolder("first")
        val second = temporary.newFolder("second")
        File(first, "keep").writeText("keep")
        ServerPluginRuntime.prepare(runtime, first)
        ServerPluginRuntime.prepare(runtime, second)
        assertTrue(File(first, "keep").exists())
        ServerPluginRuntime.detach(runtime)
        Files.createSymbolicLink(File(runtime, "_server-plugins").toPath(), File(temporary.root, "missing").toPath())
        ServerPluginRuntime.prepare(runtime, second)
        assertEquals(second.canonicalFile, File(runtime, "_server-plugins").canonicalFile)
        ServerPluginRuntime.detach(runtime)
    }

    @Test fun refusesToDeleteARealAliasDirectory() {
        val runtime = temporary.newFolder("runtime")
        val plugins = temporary.newFolder("plugins")
        val conflict = File(runtime, "_server-plugins/keep")
        conflict.parentFile!!.mkdirs()
        conflict.writeText("keep")
        assertThrows(Exception::class.java) { ServerPluginRuntime.prepare(runtime, plugins) }
        assertEquals("keep", conflict.readText())
    }

    @Test fun nodeLoadsHostRelativeModulesAndCommonJsThroughPreparedAlias() {
        val runtime = temporary.newFolder("runtime")
        val plugins = temporary.newFolder("data", "plugins")
        File(runtime, "package.json").writeText("""{"type":"module"}""")
        File(runtime, "src").mkdirs()
        File(runtime, "src/host.cjs").writeText("module.exports = 42")
        File(plugins, "demo").mkdirs()
        File(plugins, "demo/index.js").writeText("module.exports = require('../../src/host.cjs')")
        val script = File(runtime, "bootstrap.js")
        script.writeText("""
            import assert from 'node:assert/strict';
            const plugin = await import('./_server-plugins/demo/index.js');
            assert.equal(plugin.default, 42);
        """.trimIndent())
        ServerPluginRuntime.prepare(runtime, plugins)
        try {
            val process = ProcessBuilder(*ServerPluginRuntime.nodeArguments(script)).redirectErrorStream(true).start()
            val output = process.inputStream.bufferedReader().readText()
            assertEquals(output, 0, process.waitFor())
        } finally {
            ServerPluginRuntime.detach(runtime)
        }
    }

    @Test fun preservesExistingPackageBoundary() {
        val runtime = temporary.newFolder("runtime")
        val plugins = temporary.newFolder("plugins")
        val packageFile = File(plugins, "package.json")
        packageFile.writeText("""{"type":"module","name":"custom"}""")
        ServerPluginRuntime.prepare(runtime, plugins)
        assertEquals("""{"type":"module","name":"custom"}""", packageFile.readText())
        ServerPluginRuntime.detach(runtime)
    }
}
