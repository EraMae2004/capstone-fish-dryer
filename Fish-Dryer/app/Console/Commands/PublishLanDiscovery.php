<?php

namespace App\Console\Commands;

use App\Services\FirebaseRealtimeService;
use Illuminate\Console\Command;

class PublishLanDiscovery extends Command
{
    protected $signature = 'firebase:publish-lan
                            {--watch : Keep publishing so campus Wi-Fi IP changes are picked up}
                            {--interval=5 : Seconds between publishes when --watch is set}';

    protected $description = 'Publish this PC’s current LAN address to Firebase so the phone and ESP32 find Laravel without a hardcoded IPv4';

    public function handle(FirebaseRealtimeService $firebase): int
    {
        if (! $firebase->isEnabled()) {
            $this->error('Firebase is disabled. Set FIREBASE_ENABLED=true and FIREBASE_DATABASE_URL in .env');

            return self::FAILURE;
        }

        $interval = max(2, (int) $this->option('interval'));
        $watch = (bool) $this->option('watch');
        $lastHost = null;

        do {
            $host = $this->detectLanIpv4();
            $port = (int) env('LAN_PUBLISH_PORT', 8000);
            if (! $host) {
                $this->warn('No LAN IPv4 yet — connect Wi-Fi/hotspot, then retry.');
                if (! $watch) {
                    return self::FAILURE;
                }
                sleep($interval);

                continue;
            }

            $ok = $firebase->setLanServer([
                'host' => $host,
                'port' => $port,
                'origin' => "http://{$host}:{$port}",
                'api_base_url' => "http://{$host}:{$port}/api",
                'updated_at' => ['.sv' => 'timestamp'],
            ]);

            if (! $ok) {
                $this->error('Failed to write lan/server. Check FIREBASE_DATABASE_SECRET and that rules are deployed.');
                if (! $watch) {
                    return self::FAILURE;
                }
            } elseif ($host !== $lastHost) {
                $this->info("Published lan/server → http://{$host}:{$port}/api");
                $lastHost = $host;
            }

            if ($watch) {
                sleep($interval);
            }
        } while ($watch);

        return self::SUCCESS;
    }

    private function detectLanIpv4(): ?string
    {
        $forced = trim((string) env('LAN_PUBLISH_HOST', ''));
        if ($forced !== '' && filter_var($forced, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4)) {
            return $forced;
        }

        if (function_exists('socket_create')) {
            $sock = @socket_create(AF_INET, SOCK_DGRAM, SOL_UDP);
            if ($sock !== false) {
                @socket_connect($sock, '8.8.8.8', 53);
                $addr = null;
                @socket_getsockname($sock, $addr);
                @socket_close($sock);
                if (is_string($addr) && $this->isUsableLanIp($addr)) {
                    return $addr;
                }
            }
        }

        if (PHP_OS_FAMILY === 'Windows') {
            $out = [];
            exec('ipconfig', $out);
            $block = '';
            $candidates = [];
            foreach ($out as $line) {
                if (preg_match('/adapter\s+(.+):/i', $line, $m)) {
                    $block = strtolower($m[1]);

                    continue;
                }
                if (preg_match('/IPv4 Address[^:]*:\s*([0-9.]+)/i', $line, $m)) {
                    $ip = $m[1];
                    if (! $this->isUsableLanIp($ip)) {
                        continue;
                    }
                    $virtual = str_contains($block, 'virtual')
                        || str_contains($block, 'vmware')
                        || str_contains($block, 'vbox')
                        || str_contains($block, 'docker')
                        || str_contains($block, 'loopback')
                        || str_contains($block, 'hyper-v');
                    $candidates[] = ['ip' => $ip, 'virtual' => $virtual, 'wifi' => str_contains($block, 'wi-fi') || str_contains($block, 'wireless')];
                }
            }
            usort($candidates, function (array $a, array $b): int {
                if ($a['virtual'] !== $b['virtual']) {
                    return $a['virtual'] ? 1 : -1;
                }
                if ($a['wifi'] !== $b['wifi']) {
                    return $a['wifi'] ? -1 : 1;
                }

                return 0;
            });
            if ($candidates !== []) {
                return $candidates[0]['ip'];
            }
        }

        return null;
    }

    private function isUsableLanIp(string $ip): bool
    {
        if (! filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4)) {
            return false;
        }
        if (str_starts_with($ip, '127.') || str_starts_with($ip, '169.254.')) {
            return false;
        }

        return true;
    }
}
