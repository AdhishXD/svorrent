#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <signal.h>
#include <stdbool.h>
#include "include/tetherkit_c.h"

static volatile sig_atomic_t g_running = 1;

static void handle_signal(int sig) {
    (void)sig;
    g_running = 0;
}

static void cleanup_orphans() {
    size_t removed = 0;
    tk_cleanup_orphan_interfaces(&removed, NULL);
}

int main(int argc, char** argv) {
    setlinebuf(stdout);
    setlinebuf(stderr);

    bool once_mode = false;
    for (int i = 1; i < argc; ++i) {
        if (strcmp(argv[i], "--list") == 0) {
            tk_device_info_t devices[8];
            size_t count = 0;
            tk_error_t err;
            memset(&err, 0, sizeof(err));
            tk_result_t res = tk_list_devices(devices, 8, &count, false, &err);
            if (res != TK_OK) {
                fprintf(stderr, "[svorrent-tetherd] Failed to list devices: %s\n", err.message);
                return 1;
            }
            if (count > 0) {
                printf("RNDIS devices found: %zu\n", count);
                const size_t capacity = sizeof(devices) / sizeof(devices[0]);
                const size_t listed = count < capacity ? count : capacity;
                for (size_t d = 0; d < listed; ++d) {
                    printf("[%zu] %04x:%04x - %s\n", d, devices[d].vendor_id, devices[d].product_id, devices[d].description);
                }
                if (count > listed) {
                    printf("Showing first %zu devices.\n", listed);
                }
            } else {
                printf("No RNDIS devices found.\n");
            }
            return 0;
        }
        if (strcmp(argv[i], "--once") == 0) {
            once_mode = true;
        }
    }

    signal(SIGINT, handle_signal);
    signal(SIGTERM, handle_signal);
    signal(SIGHUP, handle_signal);

    printf("[svorrent-tetherd] Starting Svorrent Autonomous Android Tethering Engine...\n");
    
    tk_version_info_t ver;
    tk_version(&ver);
    printf("[svorrent-tetherd] Engine core: %s\n", ver.text);

    tk_environment_t env;
    tk_check_environment(&env);
    if (!env.is_root) {
        fprintf(stderr, "[svorrent-tetherd] ERROR: Daemon requires root (uid 0) to manage Darwin feth & BPF.\n");
        return 1;
    }

    tk_session_t* session = NULL;
    char active_interface[TK_INTERFACE_NAME_CAPACITY] = {0};
    bool once_connected = false;
    bool enumeration_failed = false;
    int no_ip_ticks = 0;

    while (g_running) {
        tk_device_info_t devices[4];
        size_t count = 0;
        tk_error_t err;
        memset(&err, 0, sizeof(err));

        tk_result_t res = tk_list_devices(devices, 4, &count, false, &err);
        if (!g_running) break;
        // A failed scan is not evidence that an active device disconnected.
        // Report an error once per failure streak to avoid filling launchd logs.
        if (res != TK_OK && !enumeration_failed) {
            fprintf(stderr, "[svorrent-tetherd] Failed to scan devices: %s\n", err.message);
        }
        enumeration_failed = (res != TK_OK);
        bool has_device = (res == TK_OK && count > 0);

        if (has_device && session == NULL) {
            printf("[svorrent-tetherd] Detected RNDIS device: %s (%04x:%04x). Establishing connection...\n",
                   devices[0].description, devices[0].vendor_id, devices[0].product_id);

            tk_session_config_t config;
            tk_session_config_init(&config);
            config.vendor_id = devices[0].vendor_id;
            config.product_id = devices[0].product_id;
            config.bus_number = devices[0].bus_number;
            config.device_address = devices[0].device_address;
            config.adopt_device_mac = true;

            session = tk_session_create(&config, &err);
            if (!session) {
                fprintf(stderr, "[svorrent-tetherd] Failed to create session: %s\n", err.message);
                sleep(2);
                continue;
            }

            if (tk_session_start(session, &err) != TK_OK) {
                fprintf(stderr, "[svorrent-tetherd] Failed to start session: %s\n", err.message);
                tk_session_destroy(session);
                session = NULL;
                sleep(2);
                continue;
            }

            // Wait for session to transition to RUNNING
            bool connected = false;
            for (int attempt = 0; attempt < 25 && g_running; ++attempt) {
                usleep(200000); // 200ms
                if (!g_running) break;
                tk_session_status_t status;
                if (tk_session_status_get(session, &status) == TK_OK) {
                    if (status.run_state == TK_RUN_RUNNING) {
                        strncpy(active_interface, status.system_interface, sizeof(active_interface) - 1);
                        active_interface[sizeof(active_interface) - 1] = '\0';
                        printf("[svorrent-tetherd] Virtual interface %s is UP. Requesting DHCP lease...\n",
                               active_interface);

                        tk_ip_config_t ip_config;
                        tk_ip_config_init(&ip_config);
                        ip_config.mode = TK_IP_MODE_DHCP;
                        ip_config.set_default_route = false; // Preserve Wi-Fi default route for dual-bonding

                        tk_error_t ip_err;
                        memset(&ip_err, 0, sizeof(ip_err));
                        if (tk_net_apply(active_interface, &ip_config, &ip_err) == TK_OK) {
                            printf("[svorrent-tetherd] DHCP configuration submitted on %s; awaiting an address.\n",
                                   active_interface);
                        } else {
                            fprintf(stderr, "[svorrent-tetherd] DHCP configuration warning: %s\n", ip_err.message);
                        }
                        connected = true;
                        once_connected = true;
                        break;
                    } else if (status.run_state == TK_RUN_FAILED) {
                        fprintf(stderr, "[svorrent-tetherd] Session failed: %s\n", status.fatal);
                        break;
                    }
                }
            }

            if (!connected && session) {
                if (g_running) {
                    fprintf(stderr, "[svorrent-tetherd] Session did not become ready.\n");
                }
                tk_session_stop(session);
                tk_session_destroy(session);
                session = NULL;
            }
        } else if (session != NULL) {
            tk_session_status_t status;
            if (tk_session_status_get(session, &status) == TK_OK) {
                if (status.run_state == TK_RUN_FAILED || status.run_state == TK_RUN_STOPPED) {
                    printf("[svorrent-tetherd] Session ended (%s). Resetting...\n",
                           status.run_state == TK_RUN_FAILED ? status.fatal : "stopped");
                    tk_session_destroy(session);
                    session = NULL;
                    active_interface[0] = '\0';
                    cleanup_orphans();
                } else if (status.run_state == TK_RUN_RUNNING) {
                    // Check whether interface received a valid routable IP (not link-local 169.254.x.x)
                    tk_net_state_t net_state;
                    tk_error_t net_err;
                    memset(&net_state, 0, sizeof(net_state));
                    memset(&net_err, 0, sizeof(net_err));

                    bool has_valid_ip = false;
                    if (active_interface[0] != '\0' && tk_net_query(active_interface, &net_state, &net_err) == TK_OK) {
                        if (net_state.has_address &&
                            strncmp(net_state.address, "169.254.", 8) != 0 &&
                            strcmp(net_state.address, "0.0.0.0") != 0 &&
                            net_state.address[0] != '\0') {
                            has_valid_ip = true;
                        }
                    }

                    if (has_valid_ip) {
                        no_ip_ticks = 0;
                    } else {
                        no_ip_ticks++;
                        if (!status.link_up || no_ip_ticks >= 60) {
                            printf("[svorrent-tetherd] No routable IP or link down on %s. Releasing USB device to prevent stall.\n",
                                   active_interface);
                            tk_session_stop(session);
                            tk_session_destroy(session);
                            session = NULL;
                            active_interface[0] = '\0';
                            cleanup_orphans();
                            no_ip_ticks = 0;
                            sleep(3);
                            continue;
                        } else if (no_ip_ticks % 15 == 0) {
                            // Periodically re-request DHCP while waiting for the phone's tethering toggle
                            tk_ip_config_t retry_ip;
                            tk_ip_config_init(&retry_ip);
                            retry_ip.mode = TK_IP_MODE_DHCP;
                            retry_ip.set_default_route = false;
                            tk_net_apply(active_interface, &retry_ip, NULL);
                        }
                    }
                }
            }

            if (session != NULL && res == TK_OK && !has_device) {
                printf("[svorrent-tetherd] Device disconnected. Tearing down session...\n");
                tk_session_stop(session);
                tk_session_destroy(session);
                session = NULL;
                active_interface[0] = '\0';
                cleanup_orphans();
                no_ip_ticks = 0;
            }
        }

        // Keep monitoring the first connection in --once mode, but do not
        // reconnect after it ends. Signals still perform normal cleanup.
        if (once_mode && once_connected && session == NULL) {
            break;
        }

        sleep(1);
    }

    if (session) {
        printf("[svorrent-tetherd] Clean shutdown: stopping active session...\n");
        tk_session_stop(session);
        tk_session_destroy(session);
        session = NULL;
    }
    cleanup_orphans();

    printf("[svorrent-tetherd] Stopped.\n");
    return 0;
}
