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
        $this->databaseSecret = env('FIREBASE_DATABASE_SECRET') ?: null;
    }

    /** Enabled when URL is set; secret optional (open RTDB rules / prototype). */
    public function isEnabled(): bool
    {
        return $this->enabled && $this->databaseUrl;
    }

    private function rtdbUrl(string $path): string
    {
        $base = rtrim((string) $this->databaseUrl, '/');
        $path = ltrim($path, '/');
        if (! str_ends_with($path, '.json')) {
            $path .= '.json';
        }
        $url = "{$base}/{$path}";
        $secret = trim((string) $this->databaseSecret);
        if ($secret !== '') {
            $url .= (str_contains($url, '?') ? '&' : '?').'auth='.urlencode($secret);
        }

        return $url;
    }

    /**
     * @param  array<string, mixed>  $payload
     */
    public function setMachineHardwareStatus(int $microcontrollerId, array $payload): void
    {
        if (! $this->isEnabled()) {
            return;
        }

        Http::timeout(3)
            ->withHeaders(['Content-Type' => 'application/json'])
            ->withBody(json_encode($payload, JSON_THROW_ON_ERROR), 'application/json')
            ->put($this->rtdbUrl("machines/{$microcontrollerId}/hardware_status"));
    }

    /**
     * ESP polls `assignments/{MAC}` — uppercase 12 hex, no colons (matches firmware + mobile).
     *
     * @param  array<string, mixed>  $payload
     */
    public function setDeviceAssignment(string $macSafe, array $payload): void
    {
        if (! $this->isEnabled()) {
            return;
        }

        $macSafe = strtoupper(preg_replace('/[^0-9A-F]/i', '', $macSafe));
        if ($macSafe === '') {
            return;
        }

        Http::timeout(3)
            ->withHeaders(['Content-Type' => 'application/json'])
            ->withBody(json_encode($payload, JSON_THROW_ON_ERROR), 'application/json')
            ->put($this->rtdbUrl("assignments/{$macSafe}"));
    }

    /**
     * @return array<string, mixed>|null
     */
    private function getJson(string $path): ?array
    {
        if (! $this->isEnabled()) {
            return null;
        }

        try {
            $res = Http::timeout(4)->get($this->rtdbUrl($path));
            if (! $res->successful()) {
                return null;
            }
            $data = $res->json();

            return is_array($data) ? $data : null;
        } catch (\Throwable) {
            return null;
        }
    }

    /**
     * Latest ESP telemetry (board PUTs every ~2s when assigned).
     *
     * @return array<string, mixed>|null
     */
    public function getMachineHardwareStatus(int $microcontrollerId): ?array
    {
        return $this->getJson("machines/{$microcontrollerId}/hardware_status");
    }

    /**
     * Drying command the ESP follows (fan / heaters / buzzer / LEDs).
     *
     * @return array<string, mixed>|null
     */
    public function getMachineSession(int $microcontrollerId): ?array
    {
        return $this->getJson("machines/{$microcontrollerId}/session");
    }

    /**
     * ESP32 follows `machines/{id}/session` for fan, heaters, buzzer, LEDs.
     *
     * @param  array<string, mixed>  $payload
     */
    public function setMachineSession(int $microcontrollerId, array $payload): void
    {
        if (! $this->isEnabled()) {
            return;
        }

        Http::timeout(3)
            ->withHeaders(['Content-Type' => 'application/json'])
            ->withBody(json_encode($payload, JSON_THROW_ON_ERROR), 'application/json')
            ->put($this->rtdbUrl("machines/{$microcontrollerId}/session"));
    }

    /**
     * Direct ESP command channel — firmware polls `machines/{id}/command` every ~400ms.
     *
     * @param  array<string, mixed>  $payload
     */
    public function setMachineCommand(int $microcontrollerId, array $payload): void
    {
        if (! $this->isEnabled()) {
            return;
        }

        Http::timeout(3)
            ->withHeaders(['Content-Type' => 'application/json'])
            ->withBody(json_encode($payload, JSON_THROW_ON_ERROR), 'application/json')
            ->put($this->rtdbUrl("machines/{$microcontrollerId}/command"));
    }

    public function clearMachineTestCommand(int $microcontrollerId): void
    {
        if (! $this->isEnabled()) {
            return;
        }

        Http::timeout(3)->delete($this->rtdbUrl("machines/{$microcontrollerId}/test_command"));
    }
}
