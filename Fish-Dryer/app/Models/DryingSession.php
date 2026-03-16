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
        'machine_id',
        'user_id',
        'fish_type',
        'total_fish',
        'drying_time_minutes',
        'extension_minutes',
        'status',
        'started_at',
        'ended_at',
    ];

    protected $casts = [
        'started_at' => 'datetime',
        'ended_at' => 'datetime',
        'recommendation_applied' => 'boolean',
    ];


    public function machine()
    {
        return $this->belongsTo(Machine::class);
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
}

