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

        // AI detection
        'detected_fish_species',
        'detected_fish_count',

        'appearance',
        'color',
        'texture',

        // drying classification
        'total_fully_dried',
        'total_partially_dried',
        'total_not_dried',

        // ML recommendation
        'suggested_additional_hours',
        'recommended_temperature',
        'recommended_fan_speed',
        'recommendation_text',

        'overall_status',
        'captured_at',
    ];

    protected $casts = [
        'captured_at' => 'datetime',
        'suggested_additional_hours' => 'decimal:2',
        'recommended_temperature' => 'float',
    ];

    public function dryingBatch()
    {
        return $this->belongsTo(DryingBatch::class);
    }
}
