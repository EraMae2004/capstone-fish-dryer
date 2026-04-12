<?php
namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\SoftDeletes;
use App\Models\DryingBatch;

class DryingSession extends Model
{
    use SoftDeletes;

    protected $fillable = [
        'session_code',
        'microcontroller_id',
        'user_id',

        'fish_type',
        'total_fish',

        // CONTROL PANEL
        'target_temperature',
        'fan_speed',
        'set_duration_minutes',

        // FINAL SNAPSHOT
        'final_temperature',
        'final_humidity',
        'final_moisture',

        'drying_time_minutes',
        'extension_minutes',
        

        'status',
        'started_at',
        'ended_at',
        'recommendation_applied',
    ];

    protected $casts = [
        'started_at' => 'datetime',
        'ended_at' => 'datetime',


        'target_temperature' => 'float',
        'final_temperature' => 'float',
        'final_humidity' => 'float',
        'final_moisture' => 'float',
        'recommendation_applied' => 'boolean',
    ];

    public function machine()
    {
        return $this->belongsTo(Microcontroller::class);
    }

    public function user()
    {
        return $this->belongsTo(User::class);
    }

    public function dryingBatches()
    {
        return $this->hasMany(DryingBatch::class);
    }

    public function notifications()
    {
        return $this->hasMany(Notification::class);
    }

    public function sensorLogs()
    {
        return $this->hasMany(SensorLog::class); // ✅ NEW
    }
}
