<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;


class SensorLog extends Model
{
    protected $fillable = [
        'drying_session_id',
        'temperature',
        'humidity',
        'moisture',
        'fan_speed',
        'power_source',
        'recorded_at',
    ];

    protected $casts = [
        'temperature' => 'float',
        'humidity' => 'float',
        'moisture' => 'float',
        'recorded_at' => 'datetime',
    ];

    public function dryingSession()
    {
        return $this->belongsTo(DryingSession::class);
    }
}
