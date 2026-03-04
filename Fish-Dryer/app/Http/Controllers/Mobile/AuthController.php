<?php

namespace App\Http\Controllers\Mobile;

use App\Http\Controllers\Controller;
use Illuminate\Http\Request;
use App\Models\User;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Validator;

class AuthController extends Controller
{
    public function register(Request $request)
    {
        $validator = Validator::make($request->all(), [
            'profile_picture' => 'nullable|image|mimes:jpg,jpeg,png|max:2048',
            'name' => 'required|string|max:255',
            'birthdate' => 'nullable|date',
            'address' => 'nullable|string|max:255',
            'phone' => 'required|string|max:20|unique:users,phone',
            'email' => 'required|email|max:255|unique:users,email',
            'password' => 'required|min:6|confirmed',
        ]);

        if ($validator->fails()) {
            return response()->json([
                'success' => false,
                'message' => $validator->errors()->first()
            ], 422);
        }

        $imagePath = null;

        if ($request->hasFile('profile_picture')) {
            $imagePath = $request->file('profile_picture')
                ->store('profile_pictures', 'public');
        }

        User::create([
            'profile_picture' => $imagePath,
            'name' => $request->name,
            'birthdate' => $request->birthdate,
            'address' => $request->address,
            'phone' => $request->phone,
            'email' => $request->email,
            'password' => Hash::make($request->password),
            'role' => 'user',
            'status' => 'active',
        ]);

        return response()->json([
            'success' => true,
            'message' => 'Registration successful.'
        ]);
    }


    public function login(Request $request)
    {
        $request->validate([
            'email' => 'required|email',
            'password' => 'required'
        ]);

        $user = User::where('email', $request->email)->first();

        if (!$user || !Hash::check($request->password, $user->password)) {
            return response()->json([
                'success' => false,
                'message' => 'Invalid credentials'
            ], 401);
        }

        if ($user->status === 'inactive') {
            return response()->json([
                'success' => false,
                'message' => 'Account is inactive'
            ], 403);
        }

        return response()->json([
            'success' => true,
            'message' => 'Login successful',
            'user' => $user
        ]);
    }

    public function verifyIdentity(Request $request)
    {
        $validator = Validator::make($request->all(), [
            'email' => 'required|email',
            'phone' => 'required',
            'address' => 'required'
        ]);

        if ($validator->fails()) {
            return response()->json([
                'success' => false,
                'message' => $validator->errors()->first()
            ]);
        }

        $user = User::where('email', $request->email)
            ->where('phone', $request->phone)
            ->where('address', $request->address)
            ->first();

        if (!$user) {
            return response()->json([
                'success' => false,
                'message' => 'User not found.'
            ]);
        }

        return response()->json([
            'success' => true,
            'message' => 'Identity verified.'
        ]);
    }

    public function resetPassword(Request $request)
    {
        $validator = Validator::make($request->all(), [
            'email' => 'required|email',
            'password' => 'required|min:6|confirmed'
        ]);

        if ($validator->fails()) {
            return response()->json([
                'success' => false,
                'message' => $validator->errors()->first()
            ]);
        }

        $user = User::where('email', $request->email)->first();

        if (!$user) {
            return response()->json([
                'success' => false,
                'message' => 'User not found.'
            ]);
        }

        $user->password = Hash::make($request->password);
        $user->save();

        return response()->json([
            'success' => true,
            'message' => 'Password updated successfully.'
        ]);
    }


    // ================= GET USER =================
    public function getUser($id)
    {
        $user = User::find($id);

        if (!$user) {
            return response()->json([
                'success' => false,
                'message' => 'User not found'
            ], 404);
        }

        return response()->json([
            'success' => true,
            'user' => $user
        ]);
    }


    // ================= UPDATE PROFILE =================
    public function updateProfile(Request $request, $id)
    {
        $user = User::find($id);

        if (!$user) {
            return response()->json([
                'success' => false,
                'message' => 'User not found'
            ], 404);
        }

        $request->validate([
            'profile_picture' => 'nullable|image|mimes:jpg,jpeg,png|max:2048',
            'name' => 'nullable|string|max:255',
            'phone' => 'nullable|string|max:20',
            'email' => 'nullable|email|max:255',
            'birthdate' => 'nullable|date',
            'address' => 'nullable|string|max:255',
        ]);

        // ================= REMOVE IMAGE =================
        if ($request->remove_image == "1") {

            if ($user->profile_picture &&
                \Storage::disk('public')->exists($user->profile_picture)) {

                \Storage::disk('public')->delete($user->profile_picture);
            }

            $user->profile_picture = null;
        }

        // ================= UPLOAD NEW IMAGE =================
        if ($request->hasFile('profile_picture')) {

            if ($user->profile_picture &&
                \Storage::disk('public')->exists($user->profile_picture)) {

                \Storage::disk('public')->delete($user->profile_picture);
            }

            $path = $request->file('profile_picture')
                ->store('profile_pictures', 'public');

            $user->profile_picture = $path;
        }

        // ================= UPDATE FIELDS =================
        $user->name = $request->input('name', $user->name);
        $user->phone = $request->input('phone', $user->phone);
        $user->email = $request->input('email', $user->email);
        $user->birthdate = $request->input('birthdate', $user->birthdate);
        $user->address = $request->input('address', $user->address);

        $user->save();

        return response()->json([
            'success' => true,
            'user' => $user
        ]);
    }


    // ================= CHANGE PASSWORD =================
    public function changePassword(Request $request, $id)
    {
        $user = User::find($id);

        if (!$user) {
            return response()->json([
                'success' => false,
                'message' => 'User not found'
            ], 404);
        }

        $request->validate([
            'current_password' => 'required',
            'new_password' => 'required|min:6|confirmed',
        ]);

        if (!Hash::check($request->current_password, $user->password)) {
            return response()->json([
                'success' => false,
                'message' => 'Current password incorrect'
            ], 400);
        }

        $user->password = Hash::make($request->new_password);
        $user->save();

        return response()->json([
            'success' => true,
            'message' => 'Password updated successfully'
        ]);
    }
}