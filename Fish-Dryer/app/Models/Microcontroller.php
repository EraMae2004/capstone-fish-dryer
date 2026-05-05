<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Microcontroller extends Model
{
    protected $fillable = [
        'device_id',
        'display_name',
        'last_seen',
        'created_by',
    ];

    protected $casts = [
        'last_seen' => 'datetime',
    ];

    public function creator()
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    public function hardwareStatuses()
    {
        return $this->hasMany(MachineHardwareStatus::class, 'microcontroller_id');
    }

    public function dryingSessions()
    {
        return $this->hasMany(DryingSession::class, 'microcontroller_id');
    }

    public function notifications()
    {
        return $this->hasMany(Notification::class, 'microcontroller_id');
    }
}