#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <signal.h>
#include <stdbool.h>
#include "include/tetherkit_c.h"

static volatile bool g_running = true;

static void handle_signal(int sig) {
    (void)sig;
    g_running = false;
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
            if (res == TK_OK && count > 0) {
                printf("RNDIS devices found: %zu\n", count);
                for (size_t d = 0; d < count; ++d) {
                    printf("[%zu] %04x:%04x - %s\n", d, devices[d].vendor_id, devices[d].product_id, devices[d].description);
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

    while (g_running) {
        tk_device_info_t devices[4];
        size_t count = 0;
        tk_error_t err;
        memset(&err, 0, sizeof(err));

        tk_result_t res = tk_list_devices(devices, 4, &count, false, &err);
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
                tk_session_status_t status;
                if (tk_session_status_get(session, &status) == TK_OK) {
                    if (status.run_state == TK_RUN_RUNNING) {
                        strncpy(active_interface, status.system_interface, sizeof(active_interface) - 1);
                        printf("[svorrent-tetherd] Virtual interface %s is UP. Requesting DHCP lease...\n",
                               active_interface);

                        tk_ip_config_t ip_config;
                        tk_ip_config_init(&ip_config);
                        ip_config.mode = TK_IP_MODE_DHCP;
                        ip_config.set_default_route = false; // Preserve Wi-Fi default route for dual-bonding

                        tk_error_t ip_err;
                        memset(&ip_err, 0, sizeof(ip_err));
                        if (tk_net_apply(active_interface, &ip_config, &ip_err) == TK_OK) {
                            printf("[svorrent-tetherd] DHCP lease successfully acquired on %s! Ready for bonding.\n",
                                   active_interface);
                        } else {
                            fprintf(stderr, "[svorrent-tetherd] DHCP configuration warning: %s\n", ip_err.message);
                        }
                        connected = true;
                        break;
                    } else if (status.run_state == TK_RUN_FAILED) {
                        fprintf(stderr, "[svorrent-tetherd] Session failed: %s\n", status.fatal);
                        break;
                    }
                }
            }

            if (!connected && session) {
                fprintf(stderr, "[svorrent-tetherd] Session connection timed out.\n");
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
                }
            }

            if (!has_device) {
                printf("[svorrent-tetherd] Device disconnected. Tearing down session...\n");
                tk_session_stop(session);
                tk_session_destroy(session);
                session = NULL;
                active_interface[0] = '\0';
            }
        }

        if (once_mode && session != NULL) {
            // Once mode connected, keep holding until signal
            while (g_running) {
                sleep(1);
            }
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

    printf("[svorrent-tetherd] Stopped.\n");
    return 0;
}
