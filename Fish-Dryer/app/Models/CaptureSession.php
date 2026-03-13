<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use App\Models\DryingBatch;


class CaptureSession extends Model
{
    protected $fillable = [
        'drying_batch_id',
        'capture_round',
        'image_path',
        'detected_fish_species',
        'appearance',
        'color',
        'texture',
        'total_fully_dried',
        'total_partially_dried',
        'total_not_dried',
        'suggested_additional_hours',
        'recommendation_text',
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

}
