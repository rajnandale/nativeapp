package com.nativeapp

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.core.content.ContextCompat
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate

class MainActivity : ReactActivity() {

    // Permission request launcher for Android 13+
    private val requestMediaPermission = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { isGranted ->
        if (!isGranted) {
            showPermissionRationale("This app needs access to media files to scan for duplicates.")
        }
    }

    // Permission request launcher for Android 12 and lower
    private val requestLegacyPermission = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { isGranted ->
        if (!isGranted) {
            showPermissionRationale("This app needs storage access to find duplicate files.")
        }
    }

    override fun onCreate(savedInstanceState: android.os.Bundle?) {
        super.onCreate(savedInstanceState)
        requestStoragePermission()
    }

    override fun onResume() {
        super.onResume()
        if (!hasRequiredPermissions()) {
            requestStoragePermission()
        }
    }

    /**
     * Check if the required permissions are granted.
     */
    private fun hasRequiredPermissions(): Boolean {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            ContextCompat.checkSelfPermission(
                this,
                Manifest.permission.READ_MEDIA_IMAGES
            ) == PackageManager.PERMISSION_GRANTED
        } else {
            ContextCompat.checkSelfPermission(
                this,
                Manifest.permission.READ_EXTERNAL_STORAGE
            ) == PackageManager.PERMISSION_GRANTED
        }
    }

    /**
     * Request the appropriate storage permissions based on the Android version.
     */
    private fun requestStoragePermission() {
        if (hasRequiredPermissions()) {
            // Permissions already granted
            return
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            // Android 13+: Request granular permissions
            requestMediaPermission.launch(Manifest.permission.READ_MEDIA_IMAGES)
        } else {
            // Android 12 and lower: Legacy permission
            requestLegacyPermission.launch(Manifest.permission.READ_EXTERNAL_STORAGE)
        }
    }

    /**
     * Show a rationale dialog explaining why permissions are needed.
     */
    private fun showPermissionRationale(message: String) {
        AlertDialog.Builder(this)
            .setTitle("Permission Required")
            .setMessage(message)
            .setPositiveButton("Open Settings") { _, _ ->
                openAppSettings()
            }
            .setNegativeButton("Cancel", null)
            .show()
    }

    /**
     * Open the app's settings page for manual permission granting.
     */
    private fun openAppSettings() {
        val intent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
            data = Uri.parse("package:$packageName")
        }
        startActivity(intent)
    }

    override fun getMainComponentName(): String = "nativeapp"

    override fun createReactActivityDelegate(): ReactActivityDelegate =
        DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled)
}