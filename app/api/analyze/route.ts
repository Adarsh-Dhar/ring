import { NextRequest, NextResponse } from 'next/server'
import { GoogleGenAI } from '@google/genai/node'
import { broadcastEvent } from '@/lib/sse-broadcast'

// Initialize Gemini client
const getGeminiClient = () => {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not set')
  }
  return new GoogleGenAI({ apiKey })
}

const modelName = process.env.GEMINI_MODEL || 'gemini-1.5-flash'

interface AnalysisResult {
  narration: string
  activity: string
  people_count: number
  threat_level: 'low' | 'medium' | 'high'
  reason: string
}

export async function POST(req: NextRequest) {
  try {
    const { images } = await req.json()

    if (!images || !Array.isArray(images) || images.length === 0) {
      return NextResponse.json({ error: 'No images provided' }, { status: 400 })
    }

    const ai = getGeminiClient()
    
    // Prepare image parts for Gemini
    const imageParts = images.map((base64: string) => ({
      inlineData: {
        mimeType: 'image/jpeg',
        data: base64
      }
    }))

    const prompt = `Analyze these camera frames and provide:
1. A brief narration of what you see (1-2 sentences)
2. The main activity type (e.g., "walking", "standing", "approaching", "none")
3. Estimated number of people visible
4. Threat level assessment (low/medium/high) based on behavior
5. Brief reason for threat assessment

Respond in JSON format with keys: narration, activity, people_count, threat_level, reason`

    const result = await ai.models.generateContent({
      model: modelName,
      contents: [
        { 
          role: 'user', 
          parts: [
            { text: prompt },
            ...imageParts.map((img: any) => ({ inlineData: img.inlineData }))
          ] 
        }
      ]
    })
    const text = result.candidates[0]?.content?.parts[0]?.text || ''

    // Parse JSON response
    let analysis: AnalysisResult
    try {
      // Extract JSON from response if it's wrapped in markdown
      const jsonMatch = text.match(/\{[\s\S]*\}/)
      const jsonText = jsonMatch ? jsonMatch[0] : text
      analysis = JSON.parse(jsonText)
    } catch (parseError) {
      console.error('Failed to parse Gemini response:', text)
      // Try to provide a fallback analysis if JSON parsing fails
      analysis = {
        narration: text.substring(0, 200) || 'Unable to analyze scene',
        activity: 'unknown',
        people_count: 0,
        threat_level: 'low',
        reason: 'Analysis parsing failed'
      }
    }

    // Broadcast to SSE feed
    broadcastEvent({
      type: 'ai_analysis',
      data: analysis,
      timestamp: new Date().toISOString()
    })

    return NextResponse.json(analysis)
  } catch (error) {
    console.error('Analysis error:', error)
    
    // Handle specific error types
    if (error instanceof Error) {
      const errorMessage = error.message.toLowerCase()
      
      // Rate limit error
      if (errorMessage.includes('quota') || errorMessage.includes('429')) {
        return NextResponse.json({ 
          error: 'rate_limit', 
          details: 'API rate limit exceeded. Please wait a moment before trying again.' 
        }, { status: 429 })
      }
      
      // Service unavailable
      if (errorMessage.includes('503') || errorMessage.includes('high demand')) {
        return NextResponse.json({ 
          error: 'service_unavailable', 
          details: 'AI service is currently overloaded. Please try again later.' 
        }, { status: 503 })
      }
      
      // Network timeout
      if (errorMessage.includes('timeout') || errorMessage.includes('fetch failed')) {
        return NextResponse.json({ 
          error: 'network_error', 
          details: 'Network timeout. Please check your connection.' 
        }, { status: 504 })
      }
    }
    
    return NextResponse.json({ 
      error: 'analysis failed', 
      details: error instanceof Error ? error.message : 'Unknown error' 
    }, { status: 500 })
  }
}
