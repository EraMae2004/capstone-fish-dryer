<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class MachineHardwareStatus extends Model
{
    protected $table = 'machine_hardware_status';

    protected $fillable = [
        'machine_id',
        'component_name',
        'status',
        'last_checked_at',
    ];

    protected $casts = [
        'last_checked_at' => 'datetime',
    ];

    public function machine()
    {
        return $this->belongsTo(Machine::class);
    }
}
