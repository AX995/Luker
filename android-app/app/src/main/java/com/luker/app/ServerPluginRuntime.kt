package com.luker.app

import java.io.File
import java.nio.file.Files
import java.nio.file.LinkOption

/** Keeps persistent plugins visible at the host-relative depth expected by ST plugins. */
internal object ServerPluginRuntime {
    private const val ALIAS = "_server-plugins"

    fun detach(runtimeRoot: File) {
        val alias = File(runtimeRoot, ALIAS).toPath()
        if (Files.isSymbolicLink(alias)) {
            // Never use recursive deletion: the target contains persistent user files.
            Files.delete(alias)
        } else {
            check(!Files.exists(alias, LinkOption.NOFOLLOW_LINKS)) {
                "Server plugin runtime alias is occupied: $alias"
            }
        }
    }

    fun prepare(runtimeRoot: File, pluginsRoot: File) {
        detach(runtimeRoot)
        Files.createDirectories(runtimeRoot.toPath())
        Files.createDirectories(pluginsRoot.toPath())
        // Match the conventional plugins/package.json boundary for untyped .js plugins.
        val packageFile = File(pluginsRoot, "package.json")
        if (!packageFile.exists()) {
            packageFile.writeText("{\"name\":\"sillytavern-plugins\",\"type\":\"commonjs\"}\n")
        }
        Files.createSymbolicLink(File(runtimeRoot, ALIAS).toPath(), pluginsRoot.toPath().toAbsolutePath())
    }

    fun nodeArguments(script: File, vararg serverArgs: String): Array<String> =
        arrayOf("node", "--preserve-symlinks", script.absolutePath, *serverArgs)
}
