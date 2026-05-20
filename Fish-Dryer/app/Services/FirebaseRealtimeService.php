<?php

namespace App\Services;

use Illuminate\Support\Facades\Http;

class FirebaseRealtimeService
{
    private bool $enabled;
    private ?string $databaseUrl;
    private ?string $databaseSecret;

    public function __construct()
    {
        $this->enabled = (bool) (env('FIREBASE_ENABLED', false));
        $this->databaseUrl = env('FIREBASE_DATABASE_URL') ?: null;
        // Use RTDB legacy Database Secret for server writes (simple + works on PHP 8.2/XAMPP).
        // Example: https://<project-id>-default-rtdb.asia-southeast1.firebasedatabase.app
        $this->databaseSecret = env('FIREBASE_DATABASE_SECRET') ?: null;
    }

    public function isEnabled(): bool
    {
        return $this->enabled && $this->databaseUrl && $this->databaseSecret;
    }

    /**
     * Mirror latest hardware status snapshot to Firebase RTDB.
     *
     * @param  array<string, mixed>  $payload
     */
    public function setMachineHardwareStatus(int $microcontrollerId, array $payload): void
    {
        if (! $this->isEnabled()) {
            return;
        }

        $base = rtrim((string) $this->databaseUrl, '/');
        $path = "machines/{$microcontrollerId}/hardware_status.json";
        $secret = (string) $this->databaseSecret;
        $url = "{$base}/{$path}?auth=".urlencode($secret);

        Http::timeout(3)
            ->withHeaders(['Content-Type' => 'application/json'])
            ->withBody(json_encode($payload, JSON_THROW_ON_ERROR), 'application/json')
            ->put($url);
    }

    /**
     * ESP32 polls RTDB `assignments/{macSafe}` — keep it in sync when Laravel resolves the board by MAC.
     *
     * @param  array<string, mixed>  $payload
     */
    public function setDeviceAssignment(string $macSafe, array $payload): void
    {
        if (! $this->isEnabled()) {
            return;
        }

        $macSafe = strtolower(preg_replace('/[^0-9a-f]/', '', $macSafe));
        if ($macSafe === '') {
            return;
        }

        $base = rtrim((string) $this->databaseUrl, '/');
        $path = "assignments/{$macSafe}.json";
        $secret = (string) $this->databaseSecret;
        $url = "{$base}/{$path}?auth=".urlencode($secret);

        Http::timeout(3)
            ->withHeaders(['Content-Type' => 'application/json'])
            ->withBody(json_encode($payload, JSON_THROW_ON_ERROR), 'application/json')
            ->put($url);
    }

    /**
     * Read latest hardware status snapshot from Firebase RTDB.
     *
     * @return array<string, mixed>|null
     */
    public function getMachineHardwareStatus(int $microcontrollerId): ?array
    {
        if (! $this->isEnabled()) {
            return null;
        }

        $base = rtrim((string) $this->databaseUrl, '/');
        $path = "machines/{$microcontrollerId}/hardware_status.json";
        $secret = (string) $this->databaseSecret;
        $url = "{$base}/{$path}?auth=".urlencode($secret);

        try {
            $res = Http::timeout(3)->get($url);
            if (! $res->successful()) {
                return null;
            }
            $data = $res->json();
            return is_array($data) ? $data : null;
        } catch (\Throwable $e) {
            return null;
        }
    }

    /**
     * @param  array<string, mixed>  $payload
     */
    public function setMachineSession(int $microcontrollerId, array $payload): void
    {
        if (! $this->isEnabled()) {
            return;
        }

        $base = rtrim((string) $this->databaseUrl, '/');
        $path = "machines/{$microcontrollerId}/session.json";
        $secret = (string) $this->databaseSecret;
        $url = "{$base}/{$path}?auth=".urlencode($secret);

        Http::timeout(3)
            ->withHeaders(['Content-Type' => 'application/json'])
            ->withBody(json_encode($payload, JSON_THROW_ON_ERROR), 'application/json')
            ->put($url);
    }

    public function clearMachineTestCommand(int $microcontrollerId): void
    {
        if (! $this->isEnabled()) {
            return;
        }

        $base = rtrim((string) $this->databaseUrl, '/');
        $path = "machines/{$microcontrollerId}/test_command.json";
        $secret = (string) $this->databaseSecret;
        $url = "{$base}/{$path}?auth=".urlencode($secret);

        Http::timeout(3)->delete($url);
    }
}

