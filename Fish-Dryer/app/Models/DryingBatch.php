<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class DryingBatch extends Model
{
    protected $fillable = [
        'drying_session_id',
        'tray_number',
        'final_status',
    ];


    public function dryingSession()
    {
        return $this->belongsTo(DryingSession::class);
    }

    public function captureSessions()
    {
        return $this->hasMany(CaptureSession::class);
    }
}
