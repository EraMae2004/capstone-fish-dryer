<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use App\Models\DryingSession;

class Machine extends Model
{
    protected $fillable = [
        'name',
        'status',
        'last_used_at',
        'overall_health',
        'created_by',
    ];

    protected $casts = [
        'last_used_at' => 'datetime',
    ];



    public function creator()
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    public function hardwareStatuses()
    {
        return $this->hasMany(MachineHardwareStatus::class);
    }

    public function dryingSessions()
    {
        return $this->hasMany(DryingSession::class);
    }

    public function notifications()
    {
        return $this->hasMany(Notification::class);
    }
}
