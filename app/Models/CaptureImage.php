<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class CaptureImage extends Model
{
    protected $fillable = [
        'capture_session_id',
        'tray_number',
        'side',
        'image_path',
        'detected_fully_dried',
        'detected_partially_dried',
        'detected_not_dried',
        'image_description',
        'drying_recommendation',
    ];

    public function captureSession()
    {
        return $this->belongsTo(CaptureSession::class);
    }
}
