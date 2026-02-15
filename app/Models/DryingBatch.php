<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\SoftDeletes;

class DryingBatch extends Model
{
    use SoftDeletes;

    protected $fillable = [
        'batch_code',
        'machine_id',
        'user_id',
        'fish_type',
        'quantity',
        'quantity_unit',
        'target_temperature',
        'target_humidity',
        'target_moisture',
        'final_temperature',
        'final_humidity',
        'final_moisture',
        'fan_speed',
        'planned_duration_minutes',
        'actual_duration_minutes',
        'status',
        'started_at',
        'completed_at',
    ];

    protected $casts = [
        'started_at' => 'datetime',
        'completed_at' => 'datetime',
    ];

    /* ================= RELATIONSHIPS ================= */

    public function machine()
    {
        return $this->belongsTo(Machine::class);
    }

    public function user()
    {
        return $this->belongsTo(User::class);
    }

    public function captureSessions()
    {
        return $this->hasMany(CaptureSession::class);
    }
}
