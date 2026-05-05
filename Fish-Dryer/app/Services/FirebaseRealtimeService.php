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
}

