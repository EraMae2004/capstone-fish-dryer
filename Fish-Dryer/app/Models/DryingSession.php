<?php
namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\SoftDeletes;


class DryingSession extends Model
{
    use SoftDeletes;

    protected $fillable = [
        'session_code',
        'microcontroller_id',
        'user_id',
        'fish_type',
        'total_fish',
        'target_temperature',
        'fan_speed',
        'set_duration_minutes',
        'drying_time_minutes',
        'status',
        'final_status',
        'started_at',
        'ended_at',
    ];

    protected $casts = [
        'started_at' => 'datetime',
        'ended_at' => 'datetime',
        'target_temperature' => 'float',
        'final_status' => 'string',
    ];

    public function microcontroller()
    {
        return $this->belongsTo(Microcontroller::class);
    }

    public function user()
    {
        return $this->belongsTo(User::class);
    }

    public function notifications()
    {
        return $this->hasMany(Notification::class);
    }

    public function sensorLogs()
    {
        return $this->hasMany(SensorLog::class)->orderBy('recorded_at');
    }

    public function latestLogs()
    {
        return $this->hasMany(SensorLog::class)
            ->latest('recorded_at')
            ->limit(5);
    }
}
