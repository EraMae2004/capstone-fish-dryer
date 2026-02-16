<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use App\Models\DryingBatch;


class CaptureSession extends Model
{
    protected $fillable = [
        'drying_batch_id',
        'capture_round',
        'total_fully_dried',
        'total_partially_dried',
        'total_not_dried',
        'suggested_additional_hours',
        'overall_status',
        'captured_at',
    ];

    protected $casts = [
        'captured_at' => 'datetime',
    ];

    public function dryingBatch()
    {
        return $this->belongsTo(DryingBatch::class);
    }

    public function captureImages()
    {
        return $this->hasMany(CaptureImage::class);
    }
}
