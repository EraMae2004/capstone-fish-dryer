<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Machine extends Model
{
    protected $fillable = [
        'name',
        'status',
        'created_by',
    ];

    /* ================= RELATIONSHIPS ================= */

    public function creator()
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    public function hardwareStatuses()
    {
        return $this->hasMany(MachineHardwareStatus::class);
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
