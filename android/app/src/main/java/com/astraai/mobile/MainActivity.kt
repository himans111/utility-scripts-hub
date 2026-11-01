package com.astraai.mobile

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.app.DownloadManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.provider.Settings
import android.webkit.JavascriptInterface
import android.webkit.PermissionRequest
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceError
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.TextView
import android.widget.Toast
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

class MainActivity : Activity() {
    private lateinit var webView: WebView
    private lateinit var statusOverlay: TextView
    private var fileChooserCallback: ValueCallback<Array<Uri>>? = null
    private var pendingPermissionRequest: PermissionRequest? = null
    private var pendingInstallUri: Uri? = null
    private var pendingDownloadId: Long = -1L
    @Volatile private var isCheckingForUpdate = false
    @Volatile private var mainFrameLoadFailed = false

    private val fileChooserRequest = 4102
    private val audioPermissionRequest = 4103
    private val releasesApi = "https://api.github.com/repos/himans111/utility-scripts-hub/releases/latest"

    private val downloadReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            val completedId = intent?.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1L) ?: -1L
            if (completedId != pendingDownloadId) return
            val manager = getSystemService(DOWNLOAD_SERVICE) as DownloadManager
            val query = DownloadManager.Query().setFilterById(completedId)
            manager.query(query).use { cursor ->
                if (cursor != null && cursor.moveToFirst()) {
                    val status = cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS))
                    if (status == DownloadManager.STATUS_SUCCESSFUL) {
                        pendingInstallUri = manager.getUriForDownloadedFile(completedId)
                        if (pendingInstallUri != null) promptInstallDownloadedUpdate()
                        else toast("APK downloaded, but Android could not open the installer.")
                    } else {
                        val reason = cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_REASON))
                        toast("Update download failed (code $reason). Please try again.")
                    }
                }
            }
            pendingDownloadId = -1L
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        webView = WebView(this)
        statusOverlay = TextView(this).apply {
            text = "Astra AI is loading…\n\nPlease check your internet connection. Tap here to retry."
            textSize = 15f
            setTextColor(Color.rgb(55, 55, 55))
            setBackgroundColor(Color.WHITE)
            gravity = Gravity.CENTER
            setPadding(36, 36, 36, 36)
            setOnClickListener {
                visibility = View.VISIBLE
                text = "Astra AI is loading…"
                webView.reload()
            }
        }
        val container = FrameLayout(this)
        container.addView(webView, FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        ))
        container.addView(statusOverlay, FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        ))
        setContentView(container)

        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            mediaPlaybackRequiresUserGesture = false
            allowFileAccess = false
            allowContentAccess = true
            javaScriptCanOpenWindowsAutomatically = false
            setSupportMultipleWindows(false)
            cacheMode = WebSettings.LOAD_DEFAULT
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
        }
        webView.addJavascriptInterface(AndroidBridge(), "AstraAndroid")
        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                val uri = request?.url ?: return false
                // Vercel may redirect the stable alias to a deployment-specific *.vercel.app host.
                // Keep that redirect inside this WebView instead of launching Chrome and leaving a blank app.
                val host = uri.host.orEmpty()
                val trustedHost = Uri.parse(BuildConfig.WEB_APP_URL).host
                val isTrustedHost = host == trustedHost || host == "astra-ai-site.vercel.app" || host.endsWith(".vercel.app")
                if (uri.scheme == "https" && isTrustedHost) return false
                if (request.isForMainFrame) {
                    try { startActivity(Intent(Intent.ACTION_VIEW, uri)) } catch (_: Exception) { }
                    return true
                }
                return false
            }

            override fun onPageStarted(view: WebView?, url: String?, favicon: android.graphics.Bitmap?) {
                mainFrameLoadFailed = false
                statusOverlay.visibility = View.VISIBLE
                statusOverlay.text = "Astra AI is loading…"
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                if (!mainFrameLoadFailed) statusOverlay.visibility = View.GONE
            }

            override fun onReceivedError(
                view: WebView?,
                request: WebResourceRequest?,
                error: WebResourceError?
            ) {
                if (request?.isForMainFrame == true) {
                    mainFrameLoadFailed = true
                    showLoadError("The website could not be reached.\n${error?.description ?: "Network error"}")
                }
            }

            override fun onReceivedHttpError(
                view: WebView?,
                request: WebResourceRequest?,
                errorResponse: android.webkit.WebResourceResponse?
            ) {
                if (request?.isForMainFrame == true) {
                    mainFrameLoadFailed = true
                    showLoadError("The website returned HTTP ${errorResponse?.statusCode ?: "error"}. Tap here to retry.")
                }
            }
        }
        webView.webChromeClient = object : WebChromeClient() {
            override fun onPermissionRequest(request: PermissionRequest) {
                runOnUiThread {
                    val wantsAudio = request.resources.contains(PermissionRequest.RESOURCE_AUDIO_CAPTURE)
                    if (!wantsAudio) { request.deny(); return@runOnUiThread }
                    if (ContextCompat.checkSelfPermission(this@MainActivity, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
                        request.grant(arrayOf(PermissionRequest.RESOURCE_AUDIO_CAPTURE))
                    } else {
                        pendingPermissionRequest = request
                        ActivityCompat.requestPermissions(this@MainActivity, arrayOf(Manifest.permission.RECORD_AUDIO), audioPermissionRequest)
                    }
                }
            }

            override fun onShowFileChooser(
                webView: WebView?,
                filePathCallback: ValueCallback<Array<Uri>>?,
                fileChooserParams: FileChooserParams?
            ): Boolean {
                fileChooserCallback?.onReceiveValue(null)
                this@MainActivity.fileChooserCallback = filePathCallback
                val intent = Intent(Intent.ACTION_GET_CONTENT).apply {
                    addCategory(Intent.CATEGORY_OPENABLE)
                    type = "*/*"
                    putExtra(Intent.EXTRA_MIME_TYPES, arrayOf("image/*", "application/pdf", "audio/*", "text/plain", "text/csv"))
                }
                return try { startActivityForResult(Intent.createChooser(intent, "Choose a file"), fileChooserRequest); true }
                catch (_: Exception) { this@MainActivity.fileChooserCallback = null; false }
            }
        }

        registerDownloadReceiver()

        val restoredState = if (savedInstanceState != null) webView.restoreState(savedInstanceState) else null
        // restoreState() can return null when Android saved an empty/failed WebView; always fall back to the live URL.
        if (restoredState == null) webView.loadUrl(BuildConfig.WEB_APP_URL)
    }

    private fun showLoadError(message: String) {
        runOnUiThread {
            statusOverlay.text = "Astra AI could not load.\n\n$message\n\nTap here to retry."
            statusOverlay.visibility = View.VISIBLE
        }
    }

    @Suppress("DEPRECATION")
    private fun registerDownloadReceiver() {
        val filter = IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE)
        if (Build.VERSION.SDK_INT >= 33) registerReceiver(downloadReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
        else registerReceiver(downloadReceiver, filter)
    }

    private inner class AndroidBridge {
        @JavascriptInterface
        fun checkForAppUpdate() {
            runOnUiThread { checkLatestAppRelease() }
        }
    }

    private fun checkLatestAppRelease() {
        if (isCheckingForUpdate || isFinishing) return
        isCheckingForUpdate = true
        toast("Checking Astra AI app updates…")
        Thread {
            var error: String? = null
            var latestVersionCode = 0
            var assetUrl: String? = null
            var tag = ""
            try {
                val connection = (URL(releasesApi).openConnection() as HttpURLConnection).apply {
                    requestMethod = "GET"
                    connectTimeout = 12000
                    readTimeout = 12000
                    setRequestProperty("Accept", "application/vnd.github+json")
                    setRequestProperty("User-Agent", "Astra-AI-Android")
                }
                try {
                    val responseCode = connection.responseCode
                    if (responseCode !in 200..299) throw IllegalStateException("GitHub returned HTTP $responseCode")
                    val body = connection.inputStream.bufferedReader().use { it.readText() }
                    val release = JSONObject(body)
                    tag = release.optString("tag_name")
                    latestVersionCode = tag.removePrefix("v").substringAfterLast('.').toIntOrNull() ?: 0
                    val assets = release.optJSONArray("assets") ?: throw IllegalStateException("Latest release has no APK asset")
                    for (i in 0 until assets.length()) {
                        val asset = assets.getJSONObject(i)
                        if (asset.optString("name") == "Astra-AI.apk") {
                            assetUrl = asset.optString("browser_download_url")
                            break
                        }
                    }
                    if (assetUrl.isNullOrBlank()) throw IllegalStateException("Astra-AI.apk was not found in the latest release")
                } finally { connection.disconnect() }
            } catch (e: Exception) { error = e.message ?: "Could not contact GitHub." }

            runOnUiThread {
                isCheckingForUpdate = false
                if (error != null) {
                    toast("Update check failed: $error")
                    return@runOnUiThread
                }
                val installedVersionCode = packageManager.getPackageInfo(packageName, 0).versionCode
                if (latestVersionCode <= installedVersionCode) {
                    toast("Astra AI is already up to date.")
                } else {
                    val download = assetUrl ?: return@runOnUiThread
                    android.app.AlertDialog.Builder(this)
                        .setTitle("Astra AI update available")
                        .setMessage("Version $tag is available. Download and install the update now?")
                        .setNegativeButton("Later", null)
                        .setPositiveButton("Download update") { _, _ -> downloadUpdate(download, tag) }
                        .show()
                }
            }
        }.start()
    }

    private fun downloadUpdate(url: String, tag: String) {
        if (!url.startsWith("https://github.com/") && !url.startsWith("https://objects.githubusercontent.com/")) {
            toast("The release download link is not trusted.")
            return
        }
        try {
            val request = DownloadManager.Request(Uri.parse(url))
                .setTitle("Astra AI $tag")
                .setDescription("Downloading the latest Astra AI Android update")
                .setMimeType("application/vnd.android.package-archive")
                .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                .setAllowedOverMetered(true)
                .setAllowedOverRoaming(false)
                .setDestinationInExternalFilesDir(this, Environment.DIRECTORY_DOWNLOADS, "Astra-AI-$tag.apk")
            val manager = getSystemService(DOWNLOAD_SERVICE) as DownloadManager
            pendingDownloadId = manager.enqueue(request)
            toast("Update downloading. Android will notify you when it is ready.")
        } catch (e: Exception) {
            toast("Could not start update download: ${e.message}")
        }
    }

    private fun promptInstallDownloadedUpdate() {
        val uri = pendingInstallUri ?: return
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !packageManager.canRequestPackageInstalls()) {
            android.app.AlertDialog.Builder(this)
                .setTitle("Allow Astra AI installation")
                .setMessage("Android needs your permission to install updates downloaded from GitHub. Allow Astra AI in the next screen, then return here.")
                .setNegativeButton("Cancel", null)
                .setPositiveButton("Open settings") { _, _ ->
                    val intent = Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:$packageName"))
                    startActivity(intent)
                }
                .show()
            return
        }
        installDownloadedUpdate(uri)
    }

    private fun installDownloadedUpdate(uri: Uri) {
        try {
            val install = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(uri, "application/vnd.android.package-archive")
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            startActivity(install)
            pendingInstallUri = null
        } catch (e: Exception) {
            toast("Android could not open the APK installer: ${e.message}")
        }
    }

    override fun onResume() {
        super.onResume()
        if (pendingInstallUri != null && (Build.VERSION.SDK_INT < Build.VERSION_CODES.O || packageManager.canRequestPackageInstalls())) {
            installDownloadedUpdate(pendingInstallUri!!)
        }
    }

    private fun toast(message: String) {
        runOnUiThread { Toast.makeText(this, message, Toast.LENGTH_LONG).show() }
    }

    override fun onSaveInstanceState(outState: Bundle) {
        webView.saveState(outState)
        super.onSaveInstanceState(outState)
    }

    @Deprecated("Deprecated in Android, retained for WebView file chooser compatibility")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == fileChooserRequest) {
            val result = if (resultCode == RESULT_OK && data?.data != null) arrayOf(data.data!!) else null
            fileChooserCallback?.onReceiveValue(result)
            fileChooserCallback = null
        }
    }

    @Deprecated("Deprecated for runtime permission compatibility")
    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == audioPermissionRequest) {
            val request = pendingPermissionRequest
            if (grantResults.isNotEmpty() && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
                request?.grant(arrayOf(PermissionRequest.RESOURCE_AUDIO_CAPTURE))
            } else {
                request?.deny()
                Toast.makeText(this, "Microphone permission is needed for voice input.", Toast.LENGTH_SHORT).show()
            }
            pendingPermissionRequest = null
        }
    }

    @Deprecated("Deprecated for back navigation")
    override fun onBackPressed() {
        if (::webView.isInitialized && webView.canGoBack()) webView.goBack() else super.onBackPressed()
    }

    override fun onDestroy() {
        try { unregisterReceiver(downloadReceiver) } catch (_: Exception) { }
        webView.removeJavascriptInterface("AstraAndroid")
        webView.destroy()
        super.onDestroy()
    }
}
