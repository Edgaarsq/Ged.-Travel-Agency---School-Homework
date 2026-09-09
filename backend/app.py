from flask import Flask, jsonify
app=Flask(__name__)
@app.get('/api/health')
def health(): return jsonify(status='ok',project='GED Travel Agency',mode='educational-demo')
@app.get('/api/provinces')
def provinces(): return jsonify(count=13,source='local demo dataset')
@app.get('/api/ask')
def ask(): return jsonify(answer='GED Concierge demo: try Toronto, Vancouver, Montréal or Banff.')
if __name__=='__main__': app.run(debug=True,port=5000)
