<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Notification extends Model
{
    protected $fillable = [
        'microcontroller_id',
        'user_id',
        'drying_session_id',
        'type',
        'title',
        'message',
        'is_read',
    ];

    protected $casts = [
        'is_read' => 'boolean',
    ];

    public function microcontroller()
    {
        return $this->belongsTo(Microcontroller::class);
    }

    public function user()
    {
        return $this->belongsTo(User::class);
    }

    public function dryingSession()
    {
        return $this->belongsTo(DryingSession::class);
    }
}
