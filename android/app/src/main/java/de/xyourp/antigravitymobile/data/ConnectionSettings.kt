package de.xyourp.antigravitymobile.data

/**
 * User-configured connection to the Antigravity Mobile bridge.
 *
 * The bridge multiplexes HTTP and WebSocket on a single port (default 5000), so
 * [restPort] and [wsPort] are usually identical. Both are exposed in Settings to
 * match the documented contract and allow unusual setups.
 */
data class ConnectionSettings(
    val host: String = "",
    val restPort: Int = 5000,
    val wsPort: Int = 5000,
    /** One-time pairing token issued by the PC; sent as x-device-token. */
    val deviceToken: String = "",
) {
    val isConfigured: Boolean get() = host.isNotBlank()

    val restBaseUrl: String get() = "http://$host:$restPort"
    val wsUrl: String get() = "ws://$host:$wsPort"

    fun restUrl(path: String): String =
        restBaseUrl + (if (path.startsWith("/")) path else "/$path")
}
